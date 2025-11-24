import { describe, expect, it } from 'vitest';

import type { LabelDefinition, TagRecord } from '@workers/types';
import { buildTagCellValue } from './tagCells';

const baseLabel: LabelDefinition = {
  id: 'alpha',
  name: 'Alpha',
  color: '#ff9922',
  createdAt: 1,
  updatedAt: 1
};

describe('buildTagCellValue', () => {
  it('returns null when no tag record exists for the row', () => {
    const labels = new Map<string, LabelDefinition>([[baseLabel.id, baseLabel]]);
    const result = buildTagCellValue(5, {}, labels);
    expect(result).toBeNull();
  });

  it('returns label metadata and falls back to label color', () => {
    const labels = new Map<string, LabelDefinition>([[baseLabel.id, baseLabel]]);
    const tags: Record<number, TagRecord> = {
      8: {
        labelIds: ['alpha'],
        updatedAt: 20
      }
    };

    const result = buildTagCellValue(8, tags, labels);

    expect(result).toEqual({
      rowId: 8,
      labels: [{ id: 'alpha', name: 'Alpha', color: '#ff9922' }],
      note: undefined,
      updatedAt: 20
    });
  });

  it('returns null when label metadata is missing and no note is present', () => {
    const labels = new Map<string, LabelDefinition>();
    const tags: Record<number, TagRecord> = {
      3: {
        labelIds: ['orphaned'],
        updatedAt: 42
      }
    };

    const result = buildTagCellValue(3, tags, labels);
    expect(result).toBeNull();
  });

  it('returns note-only entry when label cleared but note remains', () => {
    const labels = new Map<string, LabelDefinition>();
    const tags: Record<number, TagRecord> = {
      9: {
        labelIds: [],
        note: '  needs review ',
        updatedAt: 90
      }
    };

    const result = buildTagCellValue(9, tags, labels);
    expect(result).toEqual({
      rowId: 9,
      labels: [],
      note: 'needs review',
      updatedAt: 90
    });
  });
});
