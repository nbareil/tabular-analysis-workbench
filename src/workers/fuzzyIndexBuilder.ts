import type { FuzzyColumnSnapshot, FuzzyTokenEntry } from './fuzzyIndexStore';
import { damerauLevenshtein } from './utils/levenshtein';

const MAX_TOKENS_PER_COLUMN = 50_000;
const MAX_MEMORY_MB = 32;
const BYTES_PER_MB = 1024 * 1024;

interface TokenInfo {
  id: number;
  token: string;
  frequency: number;
  trigrams: string[];
}

export class FuzzyIndexBuilder {
  private readonly columns = new Map<string, Map<string, number>>(); // column -> token -> frequency
  private readonly trigramSize: number;
  private totalMemoryBytes = 0;

  constructor(trigramSize = 3) {
    this.trigramSize = trigramSize;
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
    let columnMap = this.columns.get(columnName);
    if (!columnMap) {
      columnMap = new Map<string, number>();
      this.columns.set(columnName, columnMap);
    }

    for (const token of tokens) {
      const current = columnMap.get(token) ?? 0;
      columnMap.set(token, current + 1);

      // Check memory limit
      if (this.totalMemoryBytes > MAX_MEMORY_MB * BYTES_PER_MB) {
        // Remove least frequent tokens if over limit
        this.trimColumn(columnMap);
      }
    }
  }

  private trimColumn(columnMap: Map<string, number>): void {
    if (columnMap.size <= MAX_TOKENS_PER_COLUMN) return;

    // Sort by frequency descending, keep top N
    const sorted = Array.from(columnMap.entries()).sort((a, b) => b[1] - a[1]);
    const toKeep = sorted.slice(0, MAX_TOKENS_PER_COLUMN);

    columnMap.clear();
    for (const [token, freq] of toKeep) {
      columnMap.set(token, freq);
    }
  }

  /**
   * Builds the final FuzzyColumnSnapshot for each column.
   */
  buildSnapshots(): FuzzyColumnSnapshot[] {
    const snapshots: FuzzyColumnSnapshot[] = [];

    for (const [columnName, tokenMap] of this.columns) {
      const tokens: FuzzyTokenEntry[] = [];
      const trigramIndex = new Map<string, number[]>(); // trigram -> tokenIds

      // Sort tokens by frequency descending
      const sortedTokens = Array.from(tokenMap.entries())
        .map(([token, frequency], index) => ({
          id: index,
          token,
          frequency,
          trigrams: this.generateTrigrams(token)
        }))
        .sort((a, b) => b.frequency - a.frequency);

      // Take only top tokens
      const topTokens = sortedTokens.slice(0, MAX_TOKENS_PER_COLUMN);

      for (const tokenInfo of topTokens) {
        tokens.push({
          id: tokenInfo.id,
          token: tokenInfo.token,
          frequency: tokenInfo.frequency
        });

        // Build trigram index
        for (const trigram of tokenInfo.trigrams) {
          const list = trigramIndex.get(trigram) ?? [];
          list.push(tokenInfo.id);
          trigramIndex.set(trigram, list);
        }
      }

      // Convert trigram index to Uint32Array format
      const trigramIndexArrays: Record<string, Uint32Array> = {};
      for (const [trigram, tokenIds] of trigramIndex) {
        trigramIndexArrays[trigram] = new Uint32Array(tokenIds);
      }

      snapshots.push({
        key: columnName,
        truncated: sortedTokens.length > MAX_TOKENS_PER_COLUMN,
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

    for (const tokenId of candidates) {
      const tokenEntry = columnSnapshot.tokens.find(t => t.id === tokenId);
      if (!tokenEntry) continue;

      const distance = damerauLevenshtein(queryNormalized, tokenEntry.token);
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
