import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, beforeEach, afterEach, vi } from 'vitest';

import { FuzzyBanner } from './FuzzyBanner';
import { useDataStore } from '@state/dataStore';
import type { FilterState } from '@state/sessionStore';
import { useFilterSync } from '@/hooks/useFilterSync';
import type { FuzzyMatchInfo } from '@workers/filterEngine';

vi.mock('@/hooks/useFilterSync');

const baseFuzzyUsed: FuzzyMatchInfo = {
  column: 'message',
  operator: 'eq',
  query: 'login sucess',
  suggestions: ['login success'],
  maxDistance: 2
};

const createFilter = (overrides: Partial<FilterState> = {}): FilterState => ({
  id: 'filter-1',
  column: 'message',
  operator: 'eq',
  value: 'login sucess',
  fuzzy: true,
  fuzzyExplicit: false,
  enabled: true,
  ...overrides
});

describe('FuzzyBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDataStore.setState((state) => ({
      ...state,
      columns: [
        {
          key: 'message',
          headerName: 'Message',
          type: 'string',
          confidence: 1,
          examples: []
        }
      ],
      fuzzyUsed: { ...baseFuzzyUsed }
    }));
  });

  afterEach(() => {
    cleanup();
    useDataStore.setState((state) => ({
      ...state,
      columns: [],
      fuzzyUsed: null
    }));
  });

  it('dispatches filter updates when selecting a different distance chip', async () => {
    const applyFilters = vi.fn().mockResolvedValue(undefined);
    const filters = [createFilter({ fuzzy: false })];

    vi.mocked(useFilterSync).mockReturnValue({
      filters,
      applyFilters
    });

    render(<FuzzyBanner />);

    const distanceButton = screen.getByRole('button', { name: '≤ 3' });
    fireEvent.click(distanceButton);

    await waitFor(() => expect(applyFilters).toHaveBeenCalledTimes(1));
    const [nextFilters] = applyFilters.mock.calls[0]!;
    expect(nextFilters).toHaveLength(1);
    expect(nextFilters[0]).toMatchObject({
      fuzzy: true,
      fuzzyExplicit: true,
      fuzzyDistance: 3,
      fuzzyDistanceExplicit: true
    });
  });

  it('handles Alt+~ keyboard toggle to exit fuzzy mode', async () => {
    const applyFilters = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useFilterSync).mockReturnValue({
      filters: [createFilter({ fuzzy: true })],
      applyFilters
    });

    render(<FuzzyBanner />);

    fireEvent.keyDown(window, { altKey: true, code: 'Backquote' });

    await waitFor(() => expect(applyFilters).toHaveBeenCalledTimes(1));
    const [nextFilters] = applyFilters.mock.calls[0]!;
    expect(nextFilters[0]).toMatchObject({
      fuzzy: false,
      fuzzyExplicit: true
    });
  });
});
