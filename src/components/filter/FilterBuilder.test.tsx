import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GridColumn } from '@state/dataStore';
import { useDataStore } from '@state/dataStore';
import type { FilterState } from '@state/sessionStore';
import { useSessionStore } from '@state/sessionStore';
import { useTagStore } from '@state/tagStore';
import type { ColumnInference, LabelDefinition } from '@workers/types';
import FilterBuilder, { buildNewFilter } from './FilterBuilder';

const mockApplyFilter = vi.fn();
const mockGetColumnValueDistribution = vi.fn();

vi.mock('@workers/dataWorkerProxy', () => {
  return {
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
  useSessionStore.getState().clear();
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
    useSessionStore.setState((state) => ({ ...state, filters: [filter] }));
    mockGetColumnValueDistribution.mockResolvedValue({
      column: 'name',
      totalRows: 100,
      nonNullRows: 10,
      distinctCount: 2,
      skipped: false,
      defaultSort: 'desc',
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
    useSessionStore.setState((state) => ({ ...state, filters: [filter] }));
    mockGetColumnValueDistribution.mockResolvedValue({
      column: 'name',
      totalRows: 100,
      nonNullRows: 10,
      distinctCount: 2,
      skipped: false,
      defaultSort: 'desc',
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
    useSessionStore.setState((state) => ({ ...state, filters: [filter] }));
    mockGetColumnValueDistribution.mockResolvedValue({
      column: 'active',
      totalRows: 100,
      nonNullRows: 10,
      distinctCount: 2,
      skipped: false,
      defaultSort: 'desc',
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
    useSessionStore.setState((state) => ({ ...state, filters: [filter] }));
    mockGetColumnValueDistribution.mockResolvedValue({
      column: 'name',
      totalRows: 100,
      nonNullRows: 100,
      distinctCount: 75,
      skipped: true,
      skipReason: 'Too many unique values',
      defaultSort: 'desc',
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
    useSessionStore.setState((state) => ({ ...state, filters: [filter] }));

    render(<FilterBuilder columns={[stringColumn]} />);

    expect(screen.queryByText('Value counts')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Value')).toBeInTheDocument();
    expect(mockGetColumnValueDistribution).not.toHaveBeenCalled();
  });
});
