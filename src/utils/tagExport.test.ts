import { describe, expect, it } from 'vitest';

import { TAG_EXPORT_VERSION, type TaggingSnapshot } from '@workers/types';
import { buildTagExportFilename, parseTagExport } from './tagExport';

const createSnapshot = (): TaggingSnapshot => ({
  labels: [
    {
      id: 'label-1',
      name: 'Needs Review',
      color: '#ff0000',
      createdAt: 1,
      updatedAt: 2
    }
  ],
  tags: {
    5: {
      labelIds: ['label-1'],
      note: 'check login event',
      updatedAt: 3
    }
  }
});

describe('buildTagExportFilename', () => {
  it('slugifies the source file name and appends the timestamp', () => {
    const timestamp = Date.UTC(2024, 0, 2, 3, 4, 5, 678);
    const result = buildTagExportFilename('Case File.CSV', timestamp);
    expect(result).toBe('case-file-annotations-2024-01-02T03-04-05-678Z.json');
  });

  it('falls back to annotations prefix when no source name provided', () => {
    const result = buildTagExportFilename(undefined, 0);
    expect(result.startsWith('annotations-annotations-')).toBe(true);
    expect(result.endsWith('.json')).toBe(true);
  });
});

describe('parseTagExport', () => {
  it('parses versioned export envelopes', () => {
    const snapshot = createSnapshot();
    const envelope = {
      version: TAG_EXPORT_VERSION,
      exportedAt: 123,
      source: { fileName: 'example.csv', rowCount: 42 },
      payload: snapshot
    };

    const parsed = parseTagExport(envelope);
    expect(parsed.snapshot).toEqual(snapshot);
    expect(parsed.metadata).toEqual({
      version: TAG_EXPORT_VERSION,
      exportedAt: 123,
      source: envelope.source
    });
  });

  it('supports legacy snapshot-only exports', () => {
    const snapshot = createSnapshot();
    // simulate legacy shape with single labelId
    const legacy = {
      ...snapshot,
      tags: {
        5: {
          labelId: 'label-1',
          note: 'check login event',
          updatedAt: 3
        }
      }
    };
    const parsed = parseTagExport(legacy);
    expect(parsed.snapshot.tags[5]?.labelIds).toEqual(['label-1']);
    expect(parsed.metadata).toBeNull();
  });

  it('rejects invalid payloads', () => {
    expect(() => parseTagExport({})).toThrow('File is not a valid annotations export.');
  });
});
