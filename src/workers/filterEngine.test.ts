import { describe, expect, it } from 'vitest';

import { evaluateFilter, collectMatchingRowIds } from './filterEngine';
import type {
  BooleanColumnBatch,
  ColumnBatch,
  ColumnInference,
  ColumnType,
  DatetimeColumnBatch,
  NumberColumnBatch,
  RowBatch,
  StringColumnBatch,
  FilterNode,
  TagRecord
} from './types';
import { TAG_COLUMN_ID } from './types';

const textEncoder = new TextEncoder();

const stringColumn = (values: string[]): StringColumnBatch => {
  const offsets = new Uint32Array(values.length + 1);
  const encodedChunks: Uint8Array[] = [];
  let totalBytes = 0;

  values.forEach((value, index) => {
    const encoded = textEncoder.encode(value);
    encodedChunks.push(encoded);
    totalBytes += encoded.byteLength;
    offsets[index + 1] = totalBytes;
  });

  const buffer = new ArrayBuffer(offsets.byteLength + totalBytes);
  const offsetsView = new Uint32Array(buffer, 0, offsets.length);
  offsetsView.set(offsets);
  const dataView = new Uint8Array(buffer, offsets.byteLength);

  let cursor = 0;
  encodedChunks.forEach((chunk) => {
    dataView.set(chunk, cursor);
    cursor += chunk.byteLength;
  });

  return {
    type: 'string',
    data: buffer,
    offsets: offsetsView
  };
};

const numberColumn = (values: Array<number | null>): NumberColumnBatch => {
  const data = new Float64Array(values.length);
  const nullMask = new Uint8Array(values.length);
  let hasNull = false;

  values.forEach((value, index) => {
    if (value == null) {
      nullMask[index] = 1;
      hasNull = true;
    } else {
      data[index] = value;
    }
  });

  return {
    type: 'number',
    data,
    nullMask: hasNull ? nullMask : undefined
  };
};

const datetimeColumn = (values: Array<string | null>): DatetimeColumnBatch => {
  const data = new Float64Array(values.length);
  const nullMask = new Uint8Array(values.length);
  let hasNull = false;

  values.forEach((value, index) => {
    if (!value) {
      nullMask[index] = 1;
      hasNull = true;
    } else {
      data[index] = Date.parse(value);
    }
  });

  return {
    type: 'datetime',
    data,
    nullMask: hasNull ? nullMask : undefined
  };
};

const booleanColumn = (values: Array<boolean | null>): BooleanColumnBatch => {
  const data = new Uint8Array(values.length);
  const nullMask = new Uint8Array(values.length);
  let hasNull = false;

  values.forEach((value, index) => {
    if (value == null) {
      nullMask[index] = 1;
      hasNull = true;
    } else {
      data[index] = value ? 1 : 0;
    }
  });

  return {
    type: 'boolean',
    data,
    nullMask: hasNull ? nullMask : undefined
  };
};

const buildRowBatch = (
  columns: Record<string, ColumnBatch>,
  columnTypes: Record<string, ColumnType>
): RowBatch => {
  const firstColumn = columns[Object.keys(columns)[0]!];
  let rowCount = 0;

  switch (firstColumn.type) {
    case 'string':
      rowCount = (firstColumn as StringColumnBatch).offsets.length - 1;
      break;
    case 'number':
      rowCount = (firstColumn as NumberColumnBatch).data.length;
      break;
    case 'datetime':
      rowCount = (firstColumn as DatetimeColumnBatch).data.length;
      break;
    case 'boolean':
      rowCount = (firstColumn as BooleanColumnBatch).data.length;
      break;
    default:
      rowCount = 0;
  }

  const rowIds = new Uint32Array(rowCount);
  for (let index = 0; index < rowCount; index += 1) {
    rowIds[index] = index;
  }

  const columnInference: Record<string, ColumnInference> = {};
  for (const [column, type] of Object.entries(columnTypes)) {
    columnInference[column] = {
      type,
      confidence: 1,
      samples: rowCount,
      nullCount: 0,
      examples: []
    };
  }

  return {
    rowIds,
    columns,
    columnTypes,
    columnInference,
    stats: { rowsParsed: rowCount, bytesParsed: 0, eof: true }
  };
};

describe('filterEngine', () => {
  it('filters rows using numeric comparison', () => {
    const batch = buildRowBatch(
      {
        value: numberColumn([10, 25, 40, null])
      },
      { value: 'number' }
    );

    const result = evaluateFilter(batch, {
      column: 'value',
      operator: 'gt',
      value: 20
    });

    expect(Array.from(result.matches)).toEqual([0, 1, 1, 0]);
    expect(result.matchedCount).toBe(2);
  });

  it('handles string contains with case-insensitivity', () => {
    const batch = buildRowBatch(
      {
        name: stringColumn(['Alice', 'Bob', 'alice cooper'])
      },
      { name: 'string' }
    );

    const result = evaluateFilter(batch, {
      column: 'name',
      operator: 'contains',
      value: 'alice'
    });

    expect(Array.from(result.matches)).toEqual([1, 0, 1]);
  });

  it('evaluates regex predicate with case sensitivity', () => {
    const batch = buildRowBatch(
      {
        name: stringColumn(['Alpha', 'beta', 'Gamma'])
      },
      { name: 'string' }
    );

    const result = evaluateFilter(batch, {
      column: 'name',
      operator: 'regex',
      value: '^A',
      caseSensitive: true
    });

    expect(Array.from(result.matches)).toEqual([1, 0, 0]);
  });

  it('evaluates matches predicate as regex include', () => {
    const batch = buildRowBatch(
      {
        code: stringColumn(['ERR-101', 'WARN-202', 'INFO-303'])
      },
      { code: 'string' }
    );

    const result = evaluateFilter(batch, {
      column: 'code',
      operator: 'matches',
      value: '^ERR'
    });

    expect(Array.from(result.matches)).toEqual([1, 0, 0]);
  });

  it('evaluates not matches predicate as regex exclusion', () => {
    const batch = buildRowBatch(
      {
        code: stringColumn(['ERR-101', 'WARN-202', 'INFO-303'])
      },
      { code: 'string' }
    );

    const result = evaluateFilter(batch, {
      column: 'code',
      operator: 'notMatches',
      value: '^ERR'
    });

    expect(Array.from(result.matches)).toEqual([0, 1, 1]);
  });

  it('respects caseSensitive flag for equality predicates', () => {
    const batch = buildRowBatch(
      {
        name: stringColumn(['Alpha', 'alpha', 'ALPHA'])
      },
      { name: 'string' }
    );

    const insensitive = evaluateFilter(batch, {
      column: 'name',
      operator: 'eq',
      value: 'alpha',
      caseSensitive: false
    });

    expect(Array.from(insensitive.matches)).toEqual([1, 1, 1]);

    const sensitive = evaluateFilter(batch, {
      column: 'name',
      operator: 'eq',
      value: 'alpha',
      caseSensitive: true
    });

    expect(Array.from(sensitive.matches)).toEqual([0, 1, 0]);
  });

  it('combines predicates with AND/OR expressions', () => {
    const batch = buildRowBatch(
      {
        status: stringColumn(['Open', 'Closed', 'Open', 'Closed']),
        amount: numberColumn([100, 50, 200, 30])
      },
      { status: 'string', amount: 'number' }
    );

    const expression: FilterNode = {
      op: 'and',
      predicates: [
        { column: 'status', operator: 'eq', value: 'open' },
        {
          op: 'or',
          predicates: [
            { column: 'amount', operator: 'gt', value: 150 },
            { column: 'amount', operator: 'eq', value: 100 }
          ]
        }
      ]
    };

    const result = evaluateFilter(batch, expression);
    expect(Array.from(result.matches)).toEqual([1, 0, 1, 0]);
    const matchingIds = Array.from(collectMatchingRowIds(batch, expression));
    expect(matchingIds).toEqual([0, 2]);
  });

  it('supports datetime range comparisons', () => {
    const batch = buildRowBatch(
      {
        timestamp: datetimeColumn(['2024-01-01T00:00:00Z', '2024-02-01T00:00:00Z', null])
      },
      { timestamp: 'datetime' }
    );

    const result = evaluateFilter(batch, {
      column: 'timestamp',
      operator: 'between',
      value: '2024-01-15T00:00:00Z',
      value2: '2024-03-01T00:00:00Z'
    });

    expect(Array.from(result.matches)).toEqual([0, 1, 0]);
  });

  it('evaluates boolean equality', () => {
    const batch = buildRowBatch(
      {
        active: booleanColumn([true, false, true, null])
      },
      { active: 'boolean' }
    );

    const result = evaluateFilter(batch, {
      column: 'active',
      operator: 'eq',
      value: true
    });

    expect(Array.from(result.matches)).toEqual([1, 0, 1, 0]);
  });

  it('evaluates label predicates using tag context', () => {
    const batch = buildRowBatch(
      {
        name: stringColumn(['foo', 'bar', 'baz'])
      },
      { name: 'string' }
    );

    const tags: Record<number, TagRecord> = {
      0: {
        labelId: 'label-1',
        updatedAt: 10
      },
      2: {
        labelId: null,
        note: 'needs review',
        updatedAt: 20
      }
    };

    const labeled = evaluateFilter(
      batch,
      {
        column: TAG_COLUMN_ID,
        operator: 'eq',
        value: 'label-1'
      },
      { tags }
    );

    expect(Array.from(labeled.matches)).toEqual([1, 0, 0]);

    const unlabeled = evaluateFilter(
      batch,
      {
        column: TAG_COLUMN_ID,
        operator: 'eq',
        value: null
      },
      { tags }
    );

    expect(Array.from(unlabeled.matches)).toEqual([0, 1, 1]);

    const notLabel = evaluateFilter(
      batch,
      {
        column: TAG_COLUMN_ID,
        operator: 'neq',
        value: 'label-1'
      },
      { tags }
    );

    expect(Array.from(notLabel.matches)).toEqual([0, 1, 1]);
  });
});
