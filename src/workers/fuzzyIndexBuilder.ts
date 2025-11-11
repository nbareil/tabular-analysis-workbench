import type { FuzzyColumnSnapshot, FuzzyTokenEntry } from './fuzzyIndexStore';
import { damerauLevenshtein } from './utils/levenshtein';

const DEFAULT_MAX_TOKENS_PER_COLUMN = 50_000;
const DEFAULT_MAX_MEMORY_MB = 32;
const BYTES_PER_MB = 1024 * 1024;
const textEncoder = new TextEncoder();

interface TokenStats {
  frequency: number;
  byteSize: number;
}

interface ColumnState {
  tokens: Map<string, TokenStats>;
  memoryBytes: number;
  truncated: boolean;
}

export interface FuzzyIndexBuilderOptions {
  trigramSize?: number;
  maxTokensPerColumn?: number;
  maxMemoryMB?: number;
}

export class FuzzyIndexBuilder {
  private readonly columns = new Map<string, ColumnState>();
  private readonly trigramSize: number;
  private readonly maxTokensPerColumn: number;
  private readonly maxMemoryBytes: number;

  constructor(options?: number | FuzzyIndexBuilderOptions) {
    const resolvedOptions: FuzzyIndexBuilderOptions =
      typeof options === 'number' ? { trigramSize: options } : options ?? {};

    this.trigramSize =
      typeof resolvedOptions.trigramSize === 'number' &&
      Number.isFinite(resolvedOptions.trigramSize)
        ? Math.max(1, Math.floor(resolvedOptions.trigramSize))
        : 3;
    this.maxTokensPerColumn =
      typeof resolvedOptions.maxTokensPerColumn === 'number' &&
      Number.isFinite(resolvedOptions.maxTokensPerColumn)
        ? Math.max(1, Math.floor(resolvedOptions.maxTokensPerColumn))
        : DEFAULT_MAX_TOKENS_PER_COLUMN;
    const memoryLimitMb =
      typeof resolvedOptions.maxMemoryMB === 'number' &&
      Number.isFinite(resolvedOptions.maxMemoryMB)
        ? resolvedOptions.maxMemoryMB
        : DEFAULT_MAX_MEMORY_MB;
    this.maxMemoryBytes = Math.max(1, Math.floor(memoryLimitMb * BYTES_PER_MB));
  }

  getTrigramSize(): number {
    return this.trigramSize;
  }

  getTokenLimit(): number {
    return this.maxTokensPerColumn;
  }

  /**
   * Adds a row's values to the fuzzy index.
   * For each column, extracts tokens from the value and updates frequency counts.
   */
  addRow(header: string[], row: string[]): void {
    for (let i = 0; i < header.length && i < row.length; i++) {
      const columnName = header[i];
      const value = row[i] ?? '';

      if (!value.trim()) continue; // skip empty values

      const tokens = this.tokenize(value);
      this.addTokensToColumn(columnName, tokens);
    }
  }

  private tokenize(value: string): string[] {
    // Normalize to lowercase and NFC
    const normalized = value.toLowerCase().normalize('NFC');

    // Split on whitespace and punctuation, filter out short tokens
    const tokens = normalized
      .split(/[\s\p{P}]+/u)
      .filter(token => token.length >= 2) // minimum token length
      .slice(0, 100); // limit tokens per value to prevent explosion

    return tokens;
  }

  private addTokensToColumn(columnName: string, tokens: string[]): void {
    let columnState = this.columns.get(columnName);
    if (!columnState) {
      columnState = {
        tokens: new Map<string, TokenStats>(),
        memoryBytes: 0,
        truncated: false
      };
      this.columns.set(columnName, columnState);
    }

    for (const token of tokens) {
      const existing = columnState.tokens.get(token);
      if (existing) {
        existing.frequency += 1;
      } else {
        const byteSize = textEncoder.encode(token).byteLength;
        columnState.tokens.set(token, { frequency: 1, byteSize });
        columnState.memoryBytes += byteSize;
      }

      if (
        columnState.tokens.size > this.maxTokensPerColumn ||
        columnState.memoryBytes > this.maxMemoryBytes
      ) {
        this.trimColumn(columnState);
      }
    }
  }

  private trimColumn(columnState: ColumnState): void {
    const sorted = Array.from(columnState.tokens.entries()).sort((a, b) => {
      const freqDelta = b[1].frequency - a[1].frequency;
      if (freqDelta !== 0) {
        return freqDelta;
      }
      return a[0].localeCompare(b[0]);
    });

    const nextTokens = new Map<string, TokenStats>();
    let nextMemoryBytes = 0;
    let truncated = false;

    for (const [token, stats] of sorted) {
      if (nextTokens.size >= this.maxTokensPerColumn) {
        truncated = true;
        break;
      }

      const wouldExceedMemory = nextMemoryBytes + stats.byteSize > this.maxMemoryBytes;
      if (nextTokens.size > 0 && wouldExceedMemory) {
        truncated = true;
        continue;
      }

      nextTokens.set(token, stats);
      nextMemoryBytes += stats.byteSize;
    }

    columnState.tokens = nextTokens;
    columnState.memoryBytes = nextMemoryBytes;
    columnState.truncated = columnState.truncated || truncated || nextTokens.size < sorted.length;
  }

  /**
   * Builds the final FuzzyColumnSnapshot for each column.
   */
  buildSnapshots(): FuzzyColumnSnapshot[] {
    const snapshots: FuzzyColumnSnapshot[] = [];

    for (const [columnName, columnState] of this.columns) {
      const tokens: FuzzyTokenEntry[] = [];
      const trigramIndex = new Map<string, number[]>(); // trigram -> tokenIds

      const sortedTokens = Array.from(columnState.tokens.entries())
        .map(([token, stats]) => ({
          token,
          frequency: stats.frequency,
          trigrams: this.generateTrigrams(token)
        }))
        .sort((a, b) => {
          if (a.frequency !== b.frequency) {
            return b.frequency - a.frequency;
          }
          return a.token.localeCompare(b.token);
        });

      const topTokens = sortedTokens.slice(0, this.maxTokensPerColumn);

      topTokens.forEach((tokenInfo, index) => {
        tokens.push({
          id: index,
          token: tokenInfo.token,
          frequency: tokenInfo.frequency
        });

        for (const trigram of tokenInfo.trigrams) {
          const list = trigramIndex.get(trigram) ?? [];
          list.push(index);
          trigramIndex.set(trigram, list);
        }
      });

      // Convert trigram index to Uint32Array format
      const trigramIndexArrays: Record<string, Uint32Array> = {};
      for (const [trigram, tokenIds] of trigramIndex) {
        trigramIndexArrays[trigram] = new Uint32Array(tokenIds);
      }

      snapshots.push({
        key: columnName,
        truncated: columnState.truncated,
        tokens,
        trigramIndex: trigramIndexArrays
      });
    }

    return snapshots;
  }

  private generateTrigrams(token: string): string[] {
    const trigrams: string[] = [];
    const len = token.length;

    if (len < this.trigramSize) {
      trigrams.push(token.padEnd(this.trigramSize, ' '));
    } else {
      for (let i = 0; i <= len - this.trigramSize; i++) {
        trigrams.push(token.slice(i, i + this.trigramSize));
      }
    }

    return trigrams;
  }

  /**
   * Searches for fuzzy matches in a specific column.
   * Returns token matches within the distance threshold.
   */
  searchColumn(
    columnSnapshot: FuzzyColumnSnapshot,
    query: string,
    maxDistance: number,
    maxResults: number
  ): Array<{ token: string; distance: number; frequency: number }> {
    const queryNormalized = query.toLowerCase().normalize('NFC');
    const queryTrigrams = this.generateTrigrams(queryNormalized);

    // Find candidate tokens via trigram overlap
    const candidates = new Set<number>();
    for (const trigram of queryTrigrams) {
      const tokenIds = columnSnapshot.trigramIndex[trigram];
      if (tokenIds) {
        for (const id of tokenIds) {
          candidates.add(id);
        }
      }
    }

    // Score candidates
    const matches: Array<{ token: string; distance: number; frequency: number }> = [];
    const tokens = columnSnapshot.tokens;

    for (const tokenId of candidates) {
      const tokenEntry = tokens[tokenId];
      if (!tokenEntry || tokenEntry.id !== tokenId) {
        continue;
      }

      const distance = damerauLevenshtein(queryNormalized, tokenEntry.token, maxDistance);
      if (distance <= maxDistance) {
        matches.push({
          token: tokenEntry.token,
          distance,
          frequency: tokenEntry.frequency
        });
      }
    }

    // Sort by distance, then frequency
    matches.sort((a, b) => {
      if (a.distance !== b.distance) return a.distance - b.distance;
      return b.frequency - a.frequency;
    });

    return matches.slice(0, maxResults);
  }
}
