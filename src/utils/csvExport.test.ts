import { describe, it, expect } from 'vitest';

import { escapeCsvCell, generateExportFilename, serializeToCsv } from './csvExport';

describe('serializeToCsv', () => {
  it('serializes simple data correctly', () => {
    const headers = ['name', 'age'];
    const rows = [
      ['Alice', '25'],
      ['Bob', '30']
    ];

    const result = serializeToCsv(headers, rows);
    expect(result).toBe('"name","age"\n"Alice","25"\n"Bob","30"\n');
  });

  it('escapes quotes in values', () => {
    const headers = ['message'];
    const rows = [['He said "hello"']];

    const result = serializeToCsv(headers, rows);
    expect(result).toBe('"message"\n"He said ""hello"""\n');
  });

  it('handles commas in values', () => {
    const headers = ['address'];
    const rows = [['123 Main St, Anytown']];

    const result = serializeToCsv(headers, rows);
    expect(result).toBe('"address"\n"123 Main St, Anytown"\n');
  });

  it('handles empty values', () => {
    const headers = ['name', 'age'];
    const rows = [['Alice', ''], ['', '30']];

    const result = serializeToCsv(headers, rows);
    expect(result).toBe('"name","age"\n"Alice",""\n"","30"\n');
  });

  it('handles null/undefined values', () => {
    const headers = ['name', 'age'];
    const rows = [['Alice', null], ['Bob', undefined]];

    const result = serializeToCsv(headers, rows);
    expect(result).toBe('"name","age"\n"Alice",""\n"Bob",""\n');
  });
});

describe('escapeCsvCell', () => {
  it('neutralises cells a spreadsheet would run as formulas', () => {
    expect(escapeCsvCell('=HYPERLINK("http://evil")')).toBe('"\'=HYPERLINK(""http://evil"")"');
    expect(escapeCsvCell('@SUM(A1)')).toBe('"\'@SUM(A1)"');
    expect(escapeCsvCell('+cmd|calc')).toBe('"\'+cmd|calc"');
    expect(escapeCsvCell('\tfoo')).toBe('"\'\tfoo"');
  });

  it('leaves plain negative and signed numbers intact', () => {
    expect(escapeCsvCell('-5')).toBe('"-5"');
    expect(escapeCsvCell('+3.2e5')).toBe('"+3.2e5"');
    expect(escapeCsvCell('-x')).toBe('"\'-x"');
  });
});

describe('generateExportFilename', () => {
  it('defaults to a .csv extension', () => {
    const result = generateExportFilename('records.csv');
    expect(result.endsWith('.csv')).toBe(true);
  });

  it('appends a .csv.gz extension when requested', () => {
    const result = generateExportFilename('records.csv', '.csv.gz');
    expect(result.endsWith('.csv.gz')).toBe(true);
  });
});
