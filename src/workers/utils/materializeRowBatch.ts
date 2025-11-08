import type {
  BooleanColumnBatch,
  ColumnBatch,
  ColumnInference,
  ColumnType,
  DatetimeColumnBatch,
  NumberColumnBatch,
  RowBatch,
  StringColumnBatch
} from '../types';

const textDecoder = new TextDecoder();

type DecodedColumn = unknown[];

export interface MaterializedRow extends Record<string, unknown> {
  __rowId: number;
}

const decodeStringColumn = (column: StringColumnBatch): string[] => {
  const offsets = column.offsets;
  const buffer = column.data;
  const values: string[] = [];
  const dataStart = offsets.length * Uint32Array.BYTES_PER_ELEMENT;
  const dataView = new Uint8Array(buffer, dataStart);

  for (let index = 0; index < offsets.length - 1; index += 1) {
    const start = offsets[index] ?? 0;
    const end = offsets[index + 1] ?? start;
    const slice = dataView.subarray(start, end);
    values.push(textDecoder.decode(slice));
  }

  return values;
};

const decodeNumberColumn = (column: NumberColumnBatch): Array<number | null> => {
  const values = Array.from(column.data);
  if (!column.nullMask) {
    return values;
  }

  return values.map((value, index) => (column.nullMask![index] === 1 ? null : value));
};

const decodeBooleanColumn = (column: BooleanColumnBatch): Array<boolean | null> => {
  const values = Array.from(column.data).map((value) => value === 1);
  if (!column.nullMask) {
    return values;
  }

  return values.map((value, index) => (column.nullMask![index] === 1 ? null : value));
};

const decodeDatetimeColumn = (column: DatetimeColumnBatch): Array<string | null> => {
  const values = Array.from(column.data).map((value) => {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) {
      return null;
    }
    // Display in UTC ISO format without milliseconds
    const iso = date.toISOString();
    return iso.replace('.000', '');
  });

  if (!column.nullMask) {
    return values;
  }

  return values.map((value, index) => (column.nullMask![index] === 1 ? null : value));
};

const decodeColumnBatch = (column: ColumnBatch): DecodedColumn => {
  switch (column.type) {
    case 'string':
      return decodeStringColumn(column);
    case 'number':
      return decodeNumberColumn(column);
    case 'boolean':
      return decodeBooleanColumn(column);
    case 'datetime':
      return decodeDatetimeColumn(column);
    default:
      return [];
  }
};

export interface MaterializedBatch {
  rows: MaterializedRow[];
  columnMeta: Record<string, { type: ColumnType; inference: ColumnInference }>;
}

export const materializeRowBatch = (batch: RowBatch): MaterializedBatch => {
  const columnNames = Object.keys(batch.columns);
  const decodedColumns: Record<string, DecodedColumn> = {};

  for (const name of columnNames) {
    decodedColumns[name] = decodeColumnBatch(batch.columns[name]!);
  }

  const rows: MaterializedRow[] = [];
  const rowIds = Array.from(batch.rowIds);
  const rowCount = rowIds.length;

  for (let index = 0; index < rowCount; index += 1) {
    const row: MaterializedRow = { __rowId: rowIds[index]! };

    for (const columnName of columnNames) {
      const columnValues = decodedColumns[columnName];
      row[columnName] = columnValues ? columnValues[index] ?? null : null;
    }

    rows.push(row);
  }

  const columnMeta: MaterializedBatch['columnMeta'] = {};

  for (const [columnName, type] of Object.entries(batch.columnTypes)) {
    const inference = batch.columnInference[columnName];
    if (!inference) {
      continue;
    }

    columnMeta[columnName] = { type, inference };
  }

  return { rows, columnMeta };
};
