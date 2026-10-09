import type { ColumnInference, ColumnType } from './types';
import { parseBoolean, parseDatetime, parseNumber } from './valueParsing';

export type ValueKind = 'null' | ColumnType;

export interface AnalyzedValue {
  kind: ValueKind;
  datetimeValue?: number;
}

export const analyzeValue = (raw: string): AnalyzedValue => {
  if (raw.trim().length === 0) {
    return { kind: 'null' };
  }
  if (parseBoolean(raw) != null) {
    return { kind: 'boolean' };
  }
  const datetimeValue = parseDatetime(raw);
  if (datetimeValue != null) {
    return { kind: 'datetime', datetimeValue };
  }
  if (parseNumber(raw) != null) {
    return { kind: 'number' };
  }
  return { kind: 'string' };
};

// Share of non-empty values that must parse for a column to get a typed interpretation.
// Raw text is always kept, so a typed column only changes filter/sort/aggregate semantics.
const TYPE_THRESHOLD = 0.9;
const MAX_EXAMPLES = 5;

interface ColumnInferenceState {
  samples: number;
  nullCount: number;
  typeCounts: Record<ColumnType, number>;
  examples: string[];
  minDatetime?: number;
  maxDatetime?: number;
}

const createInitialState = (): ColumnInferenceState => ({
  samples: 0,
  nullCount: 0,
  typeCounts: { string: 0, number: 0, datetime: 0, boolean: 0 },
  examples: []
});

export class TypeInferencer {
  private readonly state: ColumnInferenceState[];
  private readonly columns: string[];

  constructor(header: string[]) {
    this.columns = header.slice();
    this.state = this.columns.map(createInitialState);
  }

  updateRow(row: string[]): void {
    for (let index = 0; index < this.columns.length; index += 1) {
      this.update(this.state[index]!, row[index] ?? '');
    }
  }

  private update(stats: ColumnInferenceState, rawValue: string): void {
    const analysis = analyzeValue(rawValue);
    stats.samples += 1;

    if (analysis.kind === 'null') {
      stats.nullCount += 1;
      return;
    }

    if (stats.examples.length < MAX_EXAMPLES) {
      const trimmed = rawValue.trim();
      if (!stats.examples.includes(trimmed)) {
        stats.examples.push(trimmed);
      }
    }

    stats.typeCounts[analysis.kind] += 1;

    if (analysis.datetimeValue != null) {
      if (stats.minDatetime == null || analysis.datetimeValue < stats.minDatetime) {
        stats.minDatetime = analysis.datetimeValue;
      }
      if (stats.maxDatetime == null || analysis.datetimeValue > stats.maxDatetime) {
        stats.maxDatetime = analysis.datetimeValue;
      }
    }
  }

  resolveAll(): { columnTypes: Record<string, ColumnType>; columnInference: Record<string, ColumnInference> } {
    const columnTypes: Record<string, ColumnType> = {};
    const columnInference: Record<string, ColumnInference> = {};
    this.columns.forEach((column, index) => {
      const inference = resolveState(this.state[index]!);
      columnTypes[column] = inference.type;
      columnInference[column] = inference;
    });
    return { columnTypes, columnInference };
  }
}

const resolveState = (stats: ColumnInferenceState): ColumnInference => {
  const nonNullSamples = stats.samples - stats.nullCount;
  const base = {
    samples: stats.samples,
    nullCount: stats.nullCount,
    examples: stats.examples.slice(),
    minDatetime: stats.minDatetime,
    maxDatetime: stats.maxDatetime
  };

  if (nonNullSamples <= 0) {
    return { ...base, type: 'string', confidence: 1 };
  }

  // Integers that look like epochs count as datetime; a column mixing them with other numbers is numeric.
  const numericLike = stats.typeCounts.number + stats.typeCounts.datetime;
  const candidates: Array<{ type: ColumnType; ratio: number }> = [
    { type: 'boolean', ratio: stats.typeCounts.boolean / nonNullSamples },
    { type: 'datetime', ratio: stats.typeCounts.datetime / nonNullSamples },
    { type: 'number', ratio: numericLike / nonNullSamples }
  ];

  for (const candidate of candidates) {
    if (candidate.ratio >= TYPE_THRESHOLD) {
      return { ...base, type: candidate.type, confidence: Math.min(1, candidate.ratio) };
    }
  }

  return { ...base, type: 'string', confidence: stats.typeCounts.string / nonNullSamples };
};
