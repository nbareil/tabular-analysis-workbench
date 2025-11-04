import { describe, expect, it } from 'vitest';

import { buildFilterExpression } from './filterExpression';
import { TAG_COLUMN_ID, TAG_NO_LABEL_FILTER_VALUE } from '@workers/types';

describe('buildFilterExpression', () => {
  it('returns null when no filters provided', () => {
    expect(buildFilterExpression([])).toBeNull();
  });

  it('converts no-label sentinel to null for tag column', () => {
    const expression = buildFilterExpression([
      {
        id: '1',
        column: TAG_COLUMN_ID,
        operator: 'eq',
        value: TAG_NO_LABEL_FILTER_VALUE
      }
    ]);

    expect(expression).not.toBeNull();
    if (!expression) {
      throw new Error('expression should not be null');
    }
    expect(expression.predicates[0]?.value).toBeNull();
  });

  it('retains label id values for tag column filters', () => {
    const expression = buildFilterExpression([
      {
        id: '1',
        column: TAG_COLUMN_ID,
        operator: 'eq',
        value: 'label-1'
      }
    ]);

    expect(expression).not.toBeNull();
    if (!expression) {
      throw new Error('expression should not be null');
    }
    expect(expression.predicates[0]?.value).toBe('label-1');
  });
});
