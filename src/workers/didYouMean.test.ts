// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { suggestDidYouMean } from './didYouMean';
import { encodeColumn, RowBatchStore } from './rowBatchStore';
import type { FilterNode } from './types';
import { TAG_COLUMN_ID } from './types';

const createStore = async (columns: Record<string, string[]>, batchSize = 2): Promise<RowBatchStore> => {
  const store = await RowBatchStore.create('sort-test');
  const rowCount = Object.values(columns)[0]!.length;
  for (let start = 0; start < rowCount; start += batchSize) {
    const end = Math.min(rowCount, start + batchSize);
    await store.storeBatch({
      rowIds: Uint32Array.from({ length: end - start }, (_, index) => start + index),
      columns: Object.fromEntries(
        Object.entries(columns).map(([name, values]) => [name, encodeColumn(values.slice(start, end))])
      ),
      columnTypes: {},
      columnInference: {},
      stats: { rowsParsed: end, bytesParsed: 0, malformedRows: 0, eof: false }
    });
  }
  return store;
};

const messages = ['login success', 'payment complete', 'Login Success', 'login success', 'logout'];

describe('suggestDidYouMean', () => {
  it('suggests close values across batches for string equality predicates', async () => {
    const batchStore = await createStore({ message: messages });
    const suggestion = await suggestDidYouMean({
      batchStore,
      expression: { op: 'and', predicates: [{ column: 'message', operator: 'eq', value: ' login sucess ' }] },
      columnTypes: { message: 'string' }
    });
    expect(suggestion).toEqual({
      column: 'message',
      operator: 'eq',
      query: 'login sucess',
      suggestions: ['login success']
    });
  });

  it('does not suggest the exact value itself', async () => {
    const batchStore = await createStore({ message: messages });
    const suggestion = await suggestDidYouMean({
      batchStore,
      expression: { column: 'message', operator: 'eq', value: 'logout' },
      columnTypes: { message: 'string' }
    });
    expect(suggestion).toBeUndefined();
  });

  it('ignores non-equality, typed, label and very short predicates', async () => {
    const batchStore = await createStore({ message: messages, count: ['42', '43', '44', '45', '46'] });
    const expressions: Array<[FilterNode, Record<string, 'string' | 'number'>]> = [
      [{ column: 'message', operator: 'neq', value: 'login sucess' }, { message: 'string' }],
      [{ column: 'count', operator: 'eq', value: '41' }, { count: 'number' }],
      [{ column: TAG_COLUMN_ID, operator: 'eq', value: 'logot' }, {}],
      [{ column: 'message', operator: 'eq', value: 'lo' }, { message: 'string' }]
    ];
    for (const [expression, columnTypes] of expressions) {
      await expect(suggestDidYouMean({ batchStore, expression, columnTypes })).resolves.toBeUndefined();
    }
  });

  it('returns undefined without an expression', async () => {
    const batchStore = await createStore({ message: messages });
    await expect(suggestDidYouMean({ batchStore, expression: null, columnTypes: {} })).resolves.toBeUndefined();
  });
});
