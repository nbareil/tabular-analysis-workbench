import { describe, expect, it } from 'vitest';

import type { GridColumn } from '@state/dataStore';
import type { FilterState } from '@state/sessionStore';
import type { ColumnInference } from '@workers/types';
import {
  buildNonDatetimeFilterExpression,
  resolveEventTimelineConfig
} from './eventTimeline';

const columns: GridColumn[] = [
  {
    key: 'Timestamp',
    headerName: 'Timestamp',
    type: 'datetime',
    confidence: 100,
    examples: []
  },
  {
    key: 'Category',
    headerName: 'Category',
    type: 'string',
    confidence: 100,
    examples: []
  },
  {
    key: 'ObservedAt',
    headerName: 'ObservedAt',
    type: 'datetime',
    confidence: 100,
    examples: []
  }
];

const columnInference: Record<string, ColumnInference> = {
  Timestamp: {
    type: 'datetime',
    confidence: 1,
    samples: 3,
    nullCount: 0,
    examples: [],
    minDatetime: 1_000,
    maxDatetime: 9_000
  },
  Category: {
    type: 'string',
    confidence: 1,
    samples: 3,
    nullCount: 0,
    examples: []
  },
  ObservedAt: {
    type: 'datetime',
    confidence: 1,
    samples: 3,
    nullCount: 0,
    examples: [],
    minDatetime: 5_000,
    maxDatetime: 8_000
  }
};

describe('eventTimeline utilities', () => {
  it('excludes datetime filters from the timeline filter expression', () => {
    const filters: FilterState[] = [
      {
        id: 'time-filter',
        column: 'Timestamp',
        operator: 'between',
        value: 2_000,
        value2: 4_000,
        enabled: true
      },
      {
        id: 'category-filter',
        column: 'Category',
        operator: 'eq',
        value: 'auth',
        enabled: true
      }
    ];

    const expression = buildNonDatetimeFilterExpression({
      filters,
      columns
    });

    expect(expression).toEqual({
      op: 'and',
      predicates: [
        {
          id: 'category-filter',
          column: 'Category',
          operator: 'eq',
          value: 'auth',
          value2: undefined,
          caseSensitive: false
        }
      ]
    });
  });

  it('uses the first active datetime range filter and fills missing bounds from inference', () => {
    const filters: FilterState[] = [
      {
        id: 'observed-range',
        column: 'ObservedAt',
        operator: 'between',
        value: 6_000,
        value2: '',
        enabled: true
      },
      {
        id: 'category-filter',
        column: 'Category',
        operator: 'eq',
        value: 'auth',
        enabled: true
      }
    ];

    const config = resolveEventTimelineConfig({
      filters,
      columns,
      columnLayout: {
        order: ['Timestamp', 'Category', 'ObservedAt'],
        visibility: {}
      },
      columnInference
    });

    expect(config).toMatchObject({
      column: 'ObservedAt',
      columnLabel: 'ObservedAt',
      rangeStart: 5_000,
      rangeEnd: 8_000,
      selectedStart: 6_000,
      selectedEnd: 8_000
    });
    expect(config?.expression).toEqual({
      op: 'and',
      predicates: [
        {
          id: 'category-filter',
          column: 'Category',
          operator: 'eq',
          value: 'auth',
          value2: undefined,
          caseSensitive: false
        }
      ]
    });
  });

  it('falls back to the first datetime column in current column order', () => {
    const config = resolveEventTimelineConfig({
      filters: [],
      columns,
      columnLayout: {
        order: ['ObservedAt', 'Category', 'Timestamp'],
        visibility: {}
      },
      columnInference
    });

    expect(config).toMatchObject({
      column: 'ObservedAt',
      rangeStart: 5_000,
      rangeEnd: 8_000,
      selectedStart: null,
      selectedEnd: null
    });
  });
});
