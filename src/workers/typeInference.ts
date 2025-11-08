import type { ColumnType } from './types';

const EPOCH_SECONDS_REGEX = /^-?\d{10}$/;
const EPOCH_MILLIS_REGEX = /^-?\d{13}$/;
const BOOLEAN_TRUE = new Set(['true', 't', 'yes', 'y', '1']);
const BOOLEAN_FALSE = new Set(['false', 'f', 'no', 'n', '0']);

export type ValueKind = 'null' | ColumnType | 'string';

export interface AnalyzedValue {
  kind: ValueKind;
  booleanValue?: boolean;
  numberValue?: number;
  datetimeValue?: number;
}

export const analyzeValue = (raw: string): AnalyzedValue => {
  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    return { kind: 'null' };
  }

  const lower = trimmed.toLowerCase();
  if (BOOLEAN_TRUE.has(lower)) {
    return { kind: 'boolean', booleanValue: true };
  }
  if (BOOLEAN_FALSE.has(lower)) {
    return { kind: 'boolean', booleanValue: false };
  }

  // Check for epoch timestamps
  if (EPOCH_SECONDS_REGEX.test(trimmed) || EPOCH_MILLIS_REGEX.test(trimmed)) {
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      const millis = EPOCH_SECONDS_REGEX.test(trimmed) ? numeric * 1_000 : numeric;
      return { kind: 'datetime', datetimeValue: millis };
    }
  }

  const numericValue = Number(trimmed);
  if (Number.isFinite(numericValue)) {
    return { kind: 'number', numberValue: numericValue };
  }

  // Try parsing as other datetime formats
  const timestamp = Date.parse(trimmed);
  if (Number.isFinite(timestamp)) {
    return { kind: 'datetime', datetimeValue: timestamp };
  }

  return { kind: 'string' };
};

const TYPE_THRESHOLDS: Record<Exclude<ColumnType, 'string'>, number> = {
  boolean: 0.9,
  number: 0.85,
  datetime: 0.6
};

export interface ColumnInferenceState {
  samples: number;
  nullCount: number;
  typeCounts: Record<ColumnType, number>;
  examples: string[];
  minDatetime?: number;
  maxDatetime?: number;
}

export interface ColumnInferenceResult {
  type: ColumnType;
  confidence: number;
  samples: number;
  nullCount: number;
  examples: string[];
  minDatetime?: number;
  maxDatetime?: number;
}

const MAX_EXAMPLES = 5;

const createInitialState = (): ColumnInferenceState => ({
  samples: 0,
  nullCount: 0,
  typeCounts: {
    string: 0,
    number: 0,
    datetime: 0,
    boolean: 0
  },
  examples: []
});

export class TypeInferencer {
  private readonly state: Record<string, ColumnInferenceState> = {};
  private readonly columns: string[];

  constructor(header: string[]) {
    this.columns = header.slice();
    for (const column of this.columns) {
      this.state[column] = createInitialState();
    }
  }

  updateRow(row: string[]): void {
    for (let index = 0; index < this.columns.length; index += 1) {
      const column = this.columns[index]!;
      const value = row[index] ?? '';
      this.update(column, value);
    }
  }

  update(column: string, rawValue: string): void {
    const stats = this.state[column];
    if (!stats) {
      return;
    }

    const analysis = analyzeValue(rawValue);
    stats.samples += 1;

    if (analysis.kind === 'null') {
      stats.nullCount += 1;
      return;
    }

    if (stats.examples.length < MAX_EXAMPLES) {
      const trimmed = rawValue.trim();
      if (trimmed.length > 0 && !stats.examples.includes(trimmed)) {
        stats.examples.push(trimmed);
      }
    }

    if (analysis.kind === 'string') {
      stats.typeCounts.string += 1;
    } else {
      stats.typeCounts[analysis.kind] += 1;
    }

    // Track min/max for datetime values
    if (analysis.kind === 'datetime' && analysis.datetimeValue != null) {
      if (stats.minDatetime == null || analysis.datetimeValue < stats.minDatetime) {
        stats.minDatetime = analysis.datetimeValue;
      }
      if (stats.maxDatetime == null || analysis.datetimeValue > stats.maxDatetime) {
        stats.maxDatetime = analysis.datetimeValue;
      }
    }
  }

  getState(): Record<string, ColumnInferenceState> {
    return this.state;
  }

  resolve(column: string): ColumnInferenceResult {
    const stats = this.state[column];
    if (!stats) {
      return {
        type: 'string',
        confidence: 0,
        samples: 0,
        nullCount: 0,
        examples: []
      };
    }

    const nonNullSamples = stats.samples - stats.nullCount;
    if (nonNullSamples <= 0) {
      return {
        type: 'string',
        confidence: 1,
        samples: stats.samples,
        nullCount: stats.nullCount,
        examples: stats.examples.slice(),
        minDatetime: stats.minDatetime,
        maxDatetime: stats.maxDatetime
      };
    }

    const ratios: Array<{ type: ColumnType; ratio: number }> = [
      { type: 'boolean', ratio: stats.typeCounts.boolean / nonNullSamples },
      { type: 'datetime', ratio: stats.typeCounts.datetime / nonNullSamples },
      { type: 'number', ratio: stats.typeCounts.number / nonNullSamples }
    ];

    ratios.sort((a, b) => b.ratio - a.ratio);

    for (const candidate of ratios) {
      const threshold = TYPE_THRESHOLDS[candidate.type as keyof typeof TYPE_THRESHOLDS];
      if (candidate.ratio >= threshold) {
        return {
          type: candidate.type,
          confidence: Math.min(1, candidate.ratio),
          samples: stats.samples,
          nullCount: stats.nullCount,
          examples: stats.examples.slice(),
          minDatetime: stats.minDatetime,
          maxDatetime: stats.maxDatetime
        };
      }
    }

    const best = ratios[0];
    const confidence = Math.max(0, 1 - best.ratio);

    return {
      type: 'string',
      confidence: Number.isFinite(confidence) ? confidence : 1,
      samples: stats.samples,
      nullCount: stats.nullCount,
      examples: stats.examples.slice(),
      minDatetime: stats.minDatetime,
      maxDatetime: stats.maxDatetime
    };
  }
}
