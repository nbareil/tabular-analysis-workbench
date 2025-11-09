import { damerauLevenshtein, isSimilar } from './levenshtein';

describe('damerauLevenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(damerauLevenshtein('hello', 'hello')).toBe(0);
  });

  it('calculates distance for single operations', () => {
    expect(damerauLevenshtein('hello', 'hell')).toBe(1); // deletion
    expect(damerauLevenshtein('hell', 'hello')).toBe(1); // insertion
    expect(damerauLevenshtein('hello', 'hallo')).toBe(1); // substitution
  });

  it('handles transposition', () => {
    expect(damerauLevenshtein('ab', 'ba')).toBe(1); // transposition
    expect(damerauLevenshtein('hello', 'hlelo')).toBe(1); // transposition of 'e' and 'l'
  });

  it('calculates complex distances', () => {
    expect(damerauLevenshtein('kitten', 'sitting')).toBe(3);
    expect(damerauLevenshtein('saturday', 'sunday')).toBe(3);
  });

  it('handles empty strings', () => {
    expect(damerauLevenshtein('', '')).toBe(0);
    expect(damerauLevenshtein('a', '')).toBe(1);
    expect(damerauLevenshtein('', 'a')).toBe(1);
  });
});

describe('isSimilar', () => {
  it('returns true for identical strings', () => {
    expect(isSimilar('test', 'test', 0)).toBe(true);
  });

  it('returns true for strings within distance', () => {
    expect(isSimilar('hello', 'hell', 1)).toBe(true);
    expect(isSimilar('hello', 'hallo', 1)).toBe(true);
  });

  it('returns false for strings exceeding distance', () => {
    expect(isSimilar('hello', 'world', 1)).toBe(false);
    expect(isSimilar('kitten', 'sitting', 2)).toBe(false);
  });
});
