import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GridColumn } from '@state/dataStore';
import { useDataStore } from '@state/dataStore';
import type { FilterState } from '@state/sessionStore';
import { useSessionStore } from '@state/sessionStore';
import { useTagStore } from '@state/tagStore';
import { useUndoStore } from '@state/undoStore';
import { TAG_COLUMN_ID, TAG_NO_LABEL_FILTER_VALUE, type ColumnInference, type LabelDefinition } from '@workers/types';
import FilterBuilder, { buildNewFilter } from './FilterBuilder';

const mockApplyFilter = vi.fn();
const mockGetColumnValueDistribution = vi.fn();

vi.mock('@workers/dataWorkerProxy', async () => {
  const actual = await vi.importActual<typeof import('@workers/dataWorkerProxy')>('@workers/dataWorkerProxy');
  return {
    ...actual,
    getDataWorker: () => ({
      applyFilter: mockApplyFilter,
      getColumnValueDistribution: mockGetColumnValueDistribution
    })
  };
});

const createLabel = (): LabelDefinition => ({
  id: 'label-1',
  name: 'Important',
  color: '#ff00aa',
  createdAt: Date.now(),
  updatedAt: Date.now()
});

const stringColumn: GridColumn = {
  key: 'name',
  headerName: 'Name',
  type: 'string',
  confidence: 0.9,
  examples: []
};

const booleanColumn: GridColumn = {
  key: 'active',
  headerName: 'Active',
  type: 'boolean',
  confidence: 0.95,
  examples: []
};

const datetimeColumn: GridColumn = {
  key: 'created_at',
  headerName: 'Created At',
  type: 'datetime',
  confidence: 0.95,
  examples: []
};

const resetStores = () => {
  useSessionStore.getState().openFiles([]);
  useUndoStore.getState().clear();
  useTagStore.getState().reset();
  useDataStore.getState().reset();
  useTagStore.setState((state) => ({
    ...state,
    labels: [createLabel()],
    status: 'ready',
    error: null
  }));
  useDataStore.setState((state) => ({
    ...state,
    status: 'ready',
    totalRows: 100,
    matchedRows: 100
  }));
};

describe('buildNewFilter', () => {
  it('returns null when no columns exist', () => {
    const result = buildNewFilter({
      columns: [],
      columnInference: {},
      tagLabels: [createLabel()]
    });

    expect(result).toBeNull();
  });

  it('creates a default contains filter for string columns', () => {
    const result = buildNewFilter({
      columns: [stringColumn],
      columnInference: {},
      tagLabels: [createLabel()]
    });

    expect(result).not.toBeNull();
    expect(result?.column).toBe('name');
    expect(result?.operator).toBe('contains');
    expect(result?.value).toBe('');
  });

  it('skips the label column when choosing the default column', () => {
    const tagColumn: GridColumn = { ...stringColumn, key: TAG_COLUMN_ID, headerName: 'Label' };
    const result = buildNewFilter({ columns: [tagColumn, stringColumn], columnInference: {}, tagLabels: [] });
    expect(result?.column).toBe('name');
  });

  it('initialises datetime filters with between operator and inference bounds', () => {
    const columnInference: Record<string, ColumnInference> = {
      created_at: {
        type: 'datetime',
        confidence: 0.98,
        samples: 5,
        nullCount: 0,
        examples: [],
        minDatetime: 1_000,
        maxDatetime: 2_000
      }
    };

    const result = buildNewFilter({
      columns: [datetimeColumn],
      columnInference,
      tagLabels: [createLabel()]
    });

    expect(result).not.toBeNull();
    expect(result?.column).toBe('created_at');
    expect(result?.operator).toBe('between');
    expect(result?.value).toBe(1_000);
    expect(result?.value2).toBe(2_000);
    expect(result?.rawValue).toMatch(/T/);
    expect(result?.rawValue2).toMatch(/T/);
  });
});

describe('FilterBuilder editing', () => {
  beforeEach(() => {
    resetStores();
    mockApplyFilter.mockReset();
    mockGetColumnValueDistribution.mockReset();
    mockApplyFilter.mockResolvedValue({ matchedRows: 12, totalRows: 100, predicateMatchCounts: {} });
  });

  afterEach(() => {
    cleanup();
  });

  it('asks for a dataset when there are no columns', () => {
    render(<FilterBuilder columns={[]} />);
    expect(screen.getByText('Load a dataset to configure filters.')).toBeInTheDocument();
  });

  it('adds a filter as an undoable edit', async () => {
    render(<FilterBuilder columns={[stringColumn]} />);
    expect(screen.getByText(/No filters applied/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add Filter' }));

    await waitFor(() => expect(useSessionStore.getState().filters).toHaveLength(1));
    expect(useSessionStore.getState().filters[0]).toMatchObject({ column: 'name', operator: 'contains' });
    expect(useUndoStore.getState().past).toHaveLength(1);
    expect(screen.getByPlaceholderText('Value')).toBeInTheDocument();
  });

  it('shows per-filter match counts and removes filters', async () => {
    const filter: FilterState = { id: 'f-1', column: 'name', operator: 'contains', value: 'a', enabled: true };
    useSessionStore.getState().setFilters([filter]);
    useDataStore.setState({ filterPredicateMatchCounts: { 'f-1': 1234 } });

    render(<FilterBuilder columns={[stringColumn]} />);
    expect(screen.getByText(`Matches ${(1234).toLocaleString()} rows`)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(useSessionStore.getState().filters).toEqual([]));
    expect(mockApplyFilter).toHaveBeenCalledWith({ expression: null });
  });

  it('marks disabled filters', () => {
    useSessionStore
      .getState()
      .setFilters([{ id: 'f-1', column: 'name', operator: 'contains', value: 'a', enabled: false }]);
    render(<FilterBuilder columns={[stringColumn]} />);
    expect(screen.getByText('Filter disabled')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Enabled' })).not.toBeChecked();
  });

  it('switching to the label column offers labels with exact-match operators', async () => {
    useSessionStore
      .getState()
      .setFilters([{ id: 'f-1', column: 'name', operator: 'contains', value: '', enabled: true }]);
    render(<FilterBuilder columns={[stringColumn]} />);

    fireEvent.change(screen.getByDisplayValue('Name'), { target: { value: TAG_COLUMN_ID } });

    await waitFor(() =>
      expect(useSessionStore.getState().filters[0]).toMatchObject({
        column: TAG_COLUMN_ID,
        operator: 'eq',
        value: 'label-1'
      })
    );
    expect(screen.getByRole('option', { name: 'Important' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'No label' })).toHaveAttribute('value', TAG_NO_LABEL_FILTER_VALUE);
    expect(screen.queryByRole('option', { name: 'contains' })).not.toBeInTheDocument();
    expect(screen.getByText('Label filters use exact match')).toBeInTheDocument();
  });

it('switching a text filter with a value to the label column picks a real label', async () => {
    useSessionStore
      .getState()
      .setFilters([{ id: 'f-1', column: 'name', operator: 'contains', value: 'x', enabled: true }]);
    render(<FilterBuilder columns={[stringColumn]} />);

    fireEvent.change(screen.getByDisplayValue('Name'), { target: { value: TAG_COLUMN_ID } });

    await waitFor(() => expect(useSessionStore.getState().filters[0]?.column).toBe(TAG_COLUMN_ID));
    expect(useSessionStore.getState().filters[0]?.value).toBe('label-1');
  });
});

describe('FilterBuilder value distributions', () => {
  beforeEach(() => {
    resetStores();
    mockApplyFilter.mockReset();
    mockGetColumnValueDistribution.mockReset();
    mockApplyFilter.mockResolvedValue({
      rows: [],
      matchedRows: 12,
      totalRows: 100,
      expression: null,
      predicateMatchCounts: null,
      didYouMean: null
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('loads and renders count-sorted values for equality filters', async () => {
    const filter: FilterState = {
      id: 'f-1',
      column: 'name',
      operator: 'eq',
      value: '',
      enabled: true
    };
    useSessionStore.getState().setFilters([filter]);
    mockGetColumnValueDistribution.mockResolvedValue({
      column: 'name',
      totalRows: 100,
      nonNullRows: 10,
      distinctCount: 2,
      skipped: false,
      items: [
        { value: 'beta', count: 5 },
        { value: 'alpha', count: 2 }
      ]
    });

    render(<FilterBuilder columns={[stringColumn]} />);

    await waitFor(() => expect(mockGetColumnValueDistribution).toHaveBeenCalledWith({ column: 'name' }));
    expect(await screen.findByText('Value counts')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /beta/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /alpha/i })).toBeInTheDocument();
  });

  it('toggles between descending and ascending count order without recomputing', async () => {
    const filter: FilterState = {
      id: 'f-2',
      column: 'name',
      operator: 'eq',
      value: '',
      enabled: true
    };
    useSessionStore.getState().setFilters([filter]);
    mockGetColumnValueDistribution.mockResolvedValue({
      column: 'name',
      totalRows: 100,
      nonNullRows: 10,
      distinctCount: 2,
      skipped: false,
      items: [
        { value: 'beta', count: 5 },
        { value: 'alpha', count: 2 }
      ]
    });

    render(<FilterBuilder columns={[stringColumn]} />);

    const betaButton = await screen.findByRole('button', { name: /beta/i });
    const alphaButton = await screen.findByRole('button', { name: /alpha/i });
    expect(Boolean(betaButton.compareDocumentPosition(alphaButton) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Most common' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Least common' })).toBeInTheDocument()
    );

    const alphaButtonAfter = screen.getByRole('button', { name: /alpha/i });
    const betaButtonAfter = screen.getByRole('button', { name: /beta/i });
    expect(
      Boolean(alphaButtonAfter.compareDocumentPosition(betaButtonAfter) & Node.DOCUMENT_POSITION_FOLLOWING)
    ).toBe(true);
    expect(mockGetColumnValueDistribution).toHaveBeenCalledTimes(1);
  });

  it('selects a counted value and applies the filter', async () => {
    const filter: FilterState = {
      id: 'f-3',
      column: 'active',
      operator: 'eq',
      value: '',
      enabled: true
    };
    useSessionStore.getState().setFilters([filter]);
    mockGetColumnValueDistribution.mockResolvedValue({
      column: 'active',
      totalRows: 100,
      nonNullRows: 10,
      distinctCount: 2,
      skipped: false,
      items: [
        { value: 'true', count: 6 },
        { value: 'false', count: 4 }
      ]
    });

    render(<FilterBuilder columns={[booleanColumn]} />);

    fireEvent.click(await screen.findByRole('button', { name: /true/i }));

    await waitFor(() => expect(mockApplyFilter).toHaveBeenCalledTimes(1));
    expect(useSessionStore.getState().filters[0]?.value).toBe('true');
  });

  it('shows the skip message when a column is too unique', async () => {
    const filter: FilterState = {
      id: 'f-4',
      column: 'name',
      operator: 'eq',
      value: '',
      enabled: true
    };
    useSessionStore.getState().setFilters([filter]);
    mockGetColumnValueDistribution.mockResolvedValue({
      column: 'name',
      totalRows: 100,
      nonNullRows: 100,
      distinctCount: 75,
      skipped: true,
      skipReason: 'Too many unique values',
      items: []
    });

    render(<FilterBuilder columns={[stringColumn]} />);

    expect(await screen.findByText('Too many unique values')).toBeInTheDocument();
  });

  it('keeps unsupported operators on the existing text input path', () => {
    const filter: FilterState = {
      id: 'f-5',
      column: 'name',
      operator: 'contains',
      value: '',
      enabled: true
    };
    useSessionStore.getState().setFilters([filter]);

    render(<FilterBuilder columns={[stringColumn]} />);

    expect(screen.queryByText('Value counts')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Value')).toBeInTheDocument();
    expect(mockGetColumnValueDistribution).not.toHaveBeenCalled();
  });

  it('requests a column once even when several filters use it', async () => {
    useSessionStore.getState().setFilters([
      { id: 'a', column: 'name', operator: 'eq', value: '', enabled: true },
      { id: 'b', column: 'name', operator: 'neq', value: '', enabled: true }
    ]);
    mockGetColumnValueDistribution.mockResolvedValue({
      column: 'name',
      totalRows: 100,
      nonNullRows: 10,
      distinctCount: 1,
      skipped: false,
      items: [{ value: 'beta', count: 5 }]
    });

    render(<FilterBuilder columns={[stringColumn]} />);

    expect(await screen.findAllByRole('button', { name: /beta/i })).toHaveLength(2);
    expect(mockGetColumnValueDistribution).toHaveBeenCalledTimes(1);
  });

  it('shows load errors with a retry', async () => {
    useSessionStore.getState().setFilters([{ id: 'a', column: 'name', operator: 'eq', value: '', enabled: true }]);
    mockGetColumnValueDistribution.mockRejectedValueOnce(new Error('worker busy')).mockResolvedValueOnce({
      column: 'name',
      totalRows: 100,
      nonNullRows: 10,
      distinctCount: 1,
      skipped: false,
      items: [{ value: 'beta', count: 5 }]
    });

    render(<FilterBuilder columns={[stringColumn]} />);

    expect(await screen.findByText('worker busy')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: /beta/i })).toBeInTheDocument();
  });

  it('does not load value counts until the dataset is ready', () => {
    useDataStore.setState({ status: 'loading' });
    useSessionStore.getState().setFilters([{ id: 'a', column: 'name', operator: 'eq', value: '', enabled: true }]);
    render(<FilterBuilder columns={[stringColumn]} />);
    expect(mockGetColumnValueDistribution).not.toHaveBeenCalled();
  });
});
