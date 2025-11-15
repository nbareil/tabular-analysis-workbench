import { describe, it, expect } from 'vitest';

import { generateExportFilename, serializeToCsv } from './csvExport';

describe('serializeToCsv', () => {
  it('serializes simple data correctly', () => {
    const headers = ['name', 'age'];
    const rows = [
      ['Alice', '25'],
      ['Bob', '30']
    ];

    const result = serializeToCsv(headers, rows);
    expect(result).toBe('"name","age"\n"Alice","25"\n"Bob","30"');
  });

  it('escapes quotes in values', () => {
    const headers = ['message'];
    const rows = [['He said "hello"']];

    const result = serializeToCsv(headers, rows);
    expect(result).toBe('"message"\n"He said ""hello"""');
  });

  it('handles commas in values', () => {
    const headers = ['address'];
    const rows = [['123 Main St, Anytown']];

    const result = serializeToCsv(headers, rows);
    expect(result).toBe('"address"\n"123 Main St, Anytown"');
  });

  it('handles empty values', () => {
    const headers = ['name', 'age'];
    const rows = [['Alice', ''], ['', '30']];

    const result = serializeToCsv(headers, rows);
    expect(result).toBe('"name","age"\n"Alice",""\n"","30"');
  });

  it('handles null/undefined values', () => {
    const headers = ['name', 'age'];
    const rows = [['Alice', null], ['Bob', undefined]];

    const result = serializeToCsv(headers, rows);
    expect(result).toBe('"name","age"\n"Alice",""\n"Bob",""');
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
