import { describe, expect, it } from 'vitest';

import { suggestDidYouMean } from './didYouMean';
import type { FilterNode } from './types';

const createBatchStore = (
  rows: Array<Record<string, unknown>>
): {
  iterateMaterializedBatches: () => AsyncGenerator<{ rowStart: number; rows: Array<Record<string, unknown>> }>;
} => ({
  async *iterateMaterializedBatches() {
    yield { rowStart: 0, rows };
  }
});

describe('suggestDidYouMean', () => {
  it('suggests close exact values for string equality predicates', async () => {
    const suggestion = await suggestDidYouMean({
      batchStore: createBatchStore([
        { message: 'login success' },
        { message: 'payment complete' }
      ]) as any,
      expression: {
        column: 'message',
        operator: 'eq',
        value: 'login sucess'
      },
      columnTypes: { message: 'string' }
    });

    expect(suggestion?.column).toBe('message');
    expect(suggestion?.suggestions).toContain('login success');
  });

  it('ignores non-string or non-equality predicates', async () => {
    const neqExpression: FilterNode = {
      column: 'message',
      operator: 'neq',
      value: 'login sucess'
    };

    const numericExpression: FilterNode = {
      column: 'count',
      operator: 'eq',
      value: 42
    };

    await expect(
      suggestDidYouMean({
        batchStore: createBatchStore([{ message: 'login success', count: 42 }]) as any,
        expression: neqExpression,
        columnTypes: { message: 'string' }
      })
    ).resolves.toBeUndefined();

    await expect(
      suggestDidYouMean({
        batchStore: createBatchStore([{ message: 'login success', count: 42 }]) as any,
        expression: numericExpression,
        columnTypes: { count: 'number' }
      })
    ).resolves.toBeUndefined();
  });
});
