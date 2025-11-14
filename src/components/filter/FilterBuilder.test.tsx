import { describe, it, expect } from 'vitest';

import type { GridColumn } from '@state/dataStore';
import type { ColumnInference, LabelDefinition } from '@workers/types';
import { buildNewFilter } from './FilterBuilder';

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

const datetimeColumn: GridColumn = {
  key: 'created_at',
  headerName: 'Created At',
  type: 'datetime',
  confidence: 0.95,
  examples: []
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
