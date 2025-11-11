import { FuzzyIndexBuilder } from './fuzzyIndexBuilder';

describe('FuzzyIndexBuilder', () => {
  it('tokenizes values correctly', () => {
    const builder = new FuzzyIndexBuilder();
    builder.addRow(['col1', 'col2'], ['hello world', 'test']);

    const snapshots = builder.buildSnapshots();
    expect(snapshots).toHaveLength(2);

    const col1 = snapshots.find(s => s.key === 'col1');
    expect(col1).toBeDefined();
    expect(col1!.tokens).toContainEqual(
      expect.objectContaining({ token: 'hello', frequency: 1 })
    );
    expect(col1!.tokens).toContainEqual(
      expect.objectContaining({ token: 'world', frequency: 1 })
    );
  });

  it('generates trigrams correctly', () => {
    const builder = new FuzzyIndexBuilder();
    builder.addRow(['col1'], ['test']);

    const snapshots = builder.buildSnapshots();
    const col1 = snapshots[0];
    const testToken = col1.tokens.find(t => t.token === 'test');
    expect(testToken).toBeDefined();

    // Trigrams for 'test': tes, est
    expect(col1.trigramIndex['tes']).toBeDefined();
    expect(col1.trigramIndex['est']).toBeDefined();
  });

  it('searches for fuzzy matches', () => {
    const builder = new FuzzyIndexBuilder();
    builder.addRow(['col1'], ['hello']);
    builder.addRow(['col1'], ['world']);
    builder.addRow(['col1'], ['test']);

    const snapshots = builder.buildSnapshots();
    const col1 = snapshots[0];

    const matches = builder.searchColumn(col1, 'helo', 2, 10);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].token).toBe('hello');
  });

  it('respects maxDistance', () => {
    const builder = new FuzzyIndexBuilder();
    builder.addRow(['col1'], ['abc']);
    builder.addRow(['col1'], ['xyz']);

    const snapshots = builder.buildSnapshots();
    const col1 = snapshots[0];

    const matches = builder.searchColumn(col1, 'abc', 0, 10); // exact only
    expect(matches).toContainEqual(
      expect.objectContaining({ token: 'abc', distance: 0 })
    );
    expect(matches).not.toContainEqual(
      expect.objectContaining({ token: 'xyz' })
    );
  });

  it('caps tokens per column and marks snapshots as truncated', () => {
    const builder = new FuzzyIndexBuilder({ maxTokensPerColumn: 2 });
    builder.addRow(['col1'], ['one two three']);
    builder.addRow(['col1'], ['four five six']);

    const snapshots = builder.buildSnapshots();
    const column = snapshots[0];

    expect(column.tokens).toHaveLength(2);
    expect(column.truncated).toBe(true);
  });

  it('enforces memory limits by keeping the most frequent tokens', () => {
    const builder = new FuzzyIndexBuilder({
      maxTokensPerColumn: 10,
      maxMemoryMB: 0.00001
    });
    builder.addRow(['col1'], ['alpha beta gamma']);
    builder.addRow(['col1'], ['alpha alpha']);
    builder.addRow(['col1'], ['beta']);

    const column = builder.buildSnapshots()[0];

    expect(column.truncated).toBe(true);
    expect(column.tokens.map(token => token.token)).toContain('alpha');
    expect(column.tokens.map(token => token.token)).toContain('beta');
    expect(column.tokens.some(token => token.token === 'gamma')).toBe(false);
  });
});
