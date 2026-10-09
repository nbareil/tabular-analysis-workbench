import { describe, expect, it } from 'vitest';

import { analyzeValue, TypeInferencer } from './typeInference';

const infer = (values: string[]) => {
  const inferencer = new TypeInferencer(['col']);
  values.forEach((value) => inferencer.updateRow([value]));
  return inferencer.resolveAll().columnInference.col!;
};

describe('analyzeValue', () => {
  it('classifies values with the strict parsers', () => {
    expect(analyzeValue('  ').kind).toBe('null');
    expect(analyzeValue('yes').kind).toBe('boolean');
    expect(analyzeValue('1').kind).toBe('number');
    expect(analyzeValue('0x10').kind).toBe('string');
    expect(analyzeValue('Infinity').kind).toBe('string');
    expect(analyzeValue('1700000000')).toEqual({ kind: 'datetime', datetimeValue: 1_700_000_000_000 });
    expect(analyzeValue('2024-01-01 00:00')).toEqual({ kind: 'datetime', datetimeValue: Date.UTC(2024, 0, 1) });
  });
});

describe('TypeInferencer', () => {
  it('infers numbers, not booleans, for 0/1 columns', () => {
    expect(infer(['1', '0', '1', '0']).type).toBe('number');
  });

  it('infers booleans from word forms', () => {
    expect(infer(['true', 'false', 'TRUE']).type).toBe('boolean');
  });

  it('infers datetime and tracks the UTC range', () => {
    const result = infer(['2024-01-02 10:00', '2024-01-01 09:00', '']);
    expect(result.type).toBe('datetime');
    expect(result.minDatetime).toBe(Date.UTC(2024, 0, 1, 9));
    expect(result.maxDatetime).toBe(Date.UTC(2024, 0, 2, 10));
    expect(result.nullCount).toBe(1);
    expect(result.samples).toBe(3);
  });

  it('treats a column mixing epoch-like integers with small integers as numeric', () => {
    expect(infer(['1700000000', '5', '12', '1700000001']).type).toBe('number');
  });

  it('requires 90% of non-empty values to parse before typing a column', () => {
    const tenPercentText = [...Array.from({ length: 9 }, (_, i) => String(i)), 'n/a'];
    expect(infer(tenPercentText).type).toBe('number');
    const twentyPercentText = [...Array.from({ length: 8 }, (_, i) => String(i)), 'n/a', 'x'];
    expect(infer(twentyPercentText).type).toBe('string');
  });

  it('ignores empty cells when computing ratios', () => {
    expect(infer(['', '', '', '3', '4']).type).toBe('number');
  });

  it('defaults all-empty columns to string', () => {
    expect(infer(['', ' ']).type).toBe('string');
  });

  it('keeps hex and Infinity columns as text', () => {
    expect(infer(['0x1', '0x2', '0xff']).type).toBe('string');
    expect(infer(['Infinity', '-Infinity']).type).toBe('string');
  });

  it('collects up to five distinct trimmed examples', () => {
    const result = infer(['a', ' a ', 'b', 'c', 'd', 'e', 'f']);
    expect(result.examples).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('resolves several columns independently and treats missing cells as empty', () => {
    const inferencer = new TypeInferencer(['n', 's']);
    inferencer.updateRow(['1']);
    inferencer.updateRow(['2', 'x']);
    const { columnTypes, columnInference } = inferencer.resolveAll();
    expect(columnTypes).toEqual({ n: 'number', s: 'string' });
    expect(columnInference.s!.nullCount).toBe(1);
  });
});
