import { describe, expect, it } from 'vitest';

import { analyzeValue, TypeInferencer } from './typeInference';

describe('analyzeValue', () => {
  it('recognizes null for empty strings', () => {
    expect(analyzeValue('')).toEqual({ kind: 'null' });
    expect(analyzeValue('   ')).toEqual({ kind: 'null' });
  });

  it('recognizes datetime for ISO formats', () => {
    expect(analyzeValue('2023-10-14')).toEqual({ kind: 'datetime', datetimeValue: Date.parse('2023-10-14') });
    expect(analyzeValue('2023-10-14T12:34:56')).toEqual({ kind: 'datetime', datetimeValue: Date.parse('2023-10-14T12:34:56') });
    expect(analyzeValue('2023-10-14T12:34:56Z')).toEqual({ kind: 'datetime', datetimeValue: Date.parse('2023-10-14T12:34:56Z') });
  });

  it('recognizes datetime for epoch timestamps', () => {
    expect(analyzeValue('1697126463')).toEqual({ kind: 'datetime', datetimeValue: 1697126463000 });
    expect(analyzeValue('1697126463000')).toEqual({ kind: 'datetime', datetimeValue: 1697126463000 });
  });

  it('recognizes datetime for common formats', () => {
    expect(analyzeValue('Oct 14 2025 01:44:33')).toEqual({ kind: 'datetime', datetimeValue: Date.parse('Oct 14 2025 01:44:33') });
    expect(analyzeValue('10/14/2025')).toEqual({ kind: 'datetime', datetimeValue: Date.parse('10/14/2025') });
    expect(analyzeValue('14-Oct-2025')).toEqual({ kind: 'datetime', datetimeValue: Date.parse('14-Oct-2025') });
    expect(analyzeValue('October 14, 2025')).toEqual({ kind: 'datetime', datetimeValue: Date.parse('October 14, 2025') });
  });

  it('recognizes boolean values', () => {
    expect(analyzeValue('true')).toEqual({ kind: 'boolean', booleanValue: true });
    expect(analyzeValue('false')).toEqual({ kind: 'boolean', booleanValue: false });
    expect(analyzeValue('yes')).toEqual({ kind: 'boolean', booleanValue: true });
    expect(analyzeValue('no')).toEqual({ kind: 'boolean', booleanValue: false });
    expect(analyzeValue('1')).toEqual({ kind: 'boolean', booleanValue: true });
    expect(analyzeValue('0')).toEqual({ kind: 'boolean', booleanValue: false });
  });

  it('recognizes numbers', () => {
    expect(analyzeValue('42')).toEqual({ kind: 'number', numberValue: 42 });
    expect(analyzeValue('3.14')).toEqual({ kind: 'number', numberValue: 3.14 });
    expect(analyzeValue('-123')).toEqual({ kind: 'number', numberValue: -123 });
  });

  it('recognizes strings for non-parseable values', () => {
    expect(analyzeValue('hello')).toEqual({ kind: 'string' });
    expect(analyzeValue('random text')).toEqual({ kind: 'string' });
  });

  it('prioritizes datetime over other types', () => {
    // Epoch timestamps are classified as datetime
    expect(analyzeValue('1697126463000')).toEqual({ kind: 'datetime', datetimeValue: 1697126463000 });
  });
});

describe('TypeInferencer', () => {
  it('infers datetime type for column with datetime values', () => {
    const inferencer = new TypeInferencer(['timestamp']);
    inferencer.updateRow(['2023-10-14']);
    inferencer.updateRow(['Oct 14 2025 01:44:33']);
    inferencer.updateRow(['1697126463000']);

    const result = inferencer.resolve('timestamp');
    expect(result.type).toBe('datetime');
    expect(result.confidence).toBeGreaterThan(0.6);
  });

  it('infers string type when confidence is low', () => {
    const inferencer = new TypeInferencer(['mixed']);
    inferencer.updateRow(['2023-10-14']);
    inferencer.updateRow(['hello']);
    inferencer.updateRow(['world']);

    const result = inferencer.resolve('mixed');
    expect(result.type).toBe('string');
  });
});
