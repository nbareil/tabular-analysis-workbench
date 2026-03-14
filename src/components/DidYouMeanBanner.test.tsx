import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, beforeEach, afterEach, vi } from 'vitest';

import { DidYouMeanBanner } from './DidYouMeanBanner';
import { useDataStore } from '@state/dataStore';
import type { FilterState } from '@state/sessionStore';
import { useFilterSync } from '@/hooks/useFilterSync';
import type { DidYouMeanInfo } from '@workers/didYouMean';

vi.mock('@/hooks/useFilterSync');

const baseDidYouMean: DidYouMeanInfo = {
  column: 'message',
  operator: 'eq',
  query: 'login sucess',
  suggestions: ['login success', 'log success']
};

const createFilter = (overrides: Partial<FilterState> = {}): FilterState => ({
  id: 'filter-1',
  column: 'message',
  operator: 'eq',
  value: 'login sucess',
  enabled: true,
  ...overrides
});

describe('DidYouMeanBanner', () => {
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
      didYouMean: { ...baseDidYouMean }
    }));
  });

  afterEach(() => {
    cleanup();
    useDataStore.setState((state) => ({
      ...state,
      columns: [],
      didYouMean: null
    }));
  });

  it('applies a clicked suggestion as the new exact filter value', async () => {
    const applyFilters = vi.fn().mockResolvedValue(undefined);
    const filters = [createFilter()];

    vi.mocked(useFilterSync).mockReturnValue({
      filters,
      applyFilters
    });

    render(<DidYouMeanBanner />);

    fireEvent.click(screen.getByRole('button', { name: 'login success' }));

    await waitFor(() => expect(applyFilters).toHaveBeenCalledTimes(1));
    const [nextFilters] = applyFilters.mock.calls[0]!;
    expect(nextFilters).toHaveLength(1);
    expect(nextFilters[0]).toMatchObject({
      value: 'login success',
      enabled: true
    });
  });

  it('does not render without any suggestions', () => {
    vi.mocked(useFilterSync).mockReturnValue({
      filters: [createFilter()],
      applyFilters: vi.fn().mockResolvedValue(undefined)
    });
    useDataStore.setState((state) => ({
      ...state,
      didYouMean: {
        ...baseDidYouMean,
        suggestions: []
      }
    }));

    render(<DidYouMeanBanner />);

    expect(screen.queryByText(/did you mean/i)).toBeNull();
  });
});
