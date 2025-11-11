import { describe, expect, it } from 'vitest';

import type { FilterState } from '@state/sessionStore';
import type { LabelDefinition } from '@workers/types';
import { TAG_COLUMN_ID, TAG_NO_LABEL_FILTER_VALUE } from '@workers/types';
import { summariseLabelFilters } from './labelFilters';

const labels: LabelDefinition[] = [
  {
    id: 'alpha',
    name: 'Alpha',
    color: '#ff9900',
    createdAt: 1,
    updatedAt: 2
  },
  {
    id: 'beta',
    name: 'Beta',
    color: '#0099ff',
    createdAt: 3,
    updatedAt: 4
  }
];

describe('summariseLabelFilters', () => {
  it('returns null when no label filters are present', () => {
    const filters: FilterState[] = [
      { id: '1', column: 'name', operator: 'contains', value: 'foo' }
    ];

    expect(summariseLabelFilters(filters, labels)).toBeNull();
  });

  it('summarises include filters with label names', () => {
    const filters: FilterState[] = [
      { id: '1', column: TAG_COLUMN_ID, operator: 'eq', value: 'alpha' }
    ];

    const summary = summariseLabelFilters(filters, labels);
    expect(summary).not.toBeNull();
    expect(summary?.include).toEqual(['Alpha']);
    expect(summary?.summary).toBe('Labels: Alpha');
  });

  it('summarises exclusion filters with sentinel mapping', () => {
    const filters: FilterState[] = [
      { id: '1', column: TAG_COLUMN_ID, operator: 'neq', value: TAG_NO_LABEL_FILTER_VALUE }
    ];

    const summary = summariseLabelFilters(filters, labels);
    expect(summary).not.toBeNull();
    expect(summary?.exclude).toEqual(['No label']);
    expect(summary?.summary).toBe('Excluding: No label');
  });

  it('summarises combined include and exclude filters', () => {
    const filters: FilterState[] = [
      { id: '1', column: TAG_COLUMN_ID, operator: 'eq', value: 'alpha' },
      { id: '2', column: TAG_COLUMN_ID, operator: 'neq', value: 'beta' }
    ];

    const summary = summariseLabelFilters(filters, labels);
    expect(summary?.include).toEqual(['Alpha']);
    expect(summary?.exclude).toEqual(['Beta']);
    expect(summary?.summary).toBe('Labels: Alpha • Excluding: Beta');
  });

  it('ignores disabled label filters', () => {
    const filters: FilterState[] = [
      { id: '1', column: TAG_COLUMN_ID, operator: 'eq', value: 'alpha', enabled: false },
      { id: '2', column: TAG_COLUMN_ID, operator: 'eq', value: 'beta' }
    ];

    const summary = summariseLabelFilters(filters, labels);
    expect(summary?.include).toEqual(['Beta']);
    expect(summary?.summary).toBe('Labels: Beta');
  });
});
