import { describe, expect, it } from 'vitest';

import type { LabelDefinition, TagRecord } from './types';
import { buildTagRecord, cascadeLabelDeletion, isTagRecordEmpty } from './taggingHelpers';

const baseLabel: LabelDefinition = {
  id: 'label-1',
  name: 'Primary',
  color: '#ff6600',
  createdAt: 1,
  updatedAt: 1
};

describe('taggingHelpers', () => {
  it('preserves existing note when note argument is omitted', () => {
    const existing: TagRecord = {
      labelIds: [baseLabel.id],
      note: 'keep me',
      updatedAt: 10
    };

    const record = buildTagRecord({
      existing,
      labelIds: [baseLabel.id],
      timestamp: 20
    });

    expect(record.note).toBe('keep me');
    expect(record.labelIds).toEqual([baseLabel.id]);
  });

  it('clears note when caller passes an empty string', () => {
    const existing: TagRecord = {
      labelIds: [baseLabel.id],
      note: 'remove me',
      updatedAt: 5
    };

    const record = buildTagRecord({
      existing,
      labelIds: [baseLabel.id],
      note: '',
      timestamp: 10
    });

    expect(record.note).toBeUndefined();
    expect(record.labelIds).toEqual([baseLabel.id]);
  });

  it('appends labels when mode is append', () => {
    const record = buildTagRecord({
      existing: { labelIds: ['existing'], updatedAt: 1 },
      labelIds: [baseLabel.id],
      mode: 'append',
      timestamp: 2
    });

    expect(record.labelIds).toEqual(['existing', baseLabel.id]);
  });

  it('cascades label deletion while retaining note content', () => {
    const record: TagRecord = {
      labelIds: [baseLabel.id, 'keep'],
      note: 'annotated',
      updatedAt: 1
    };

    const cascaded = cascadeLabelDeletion(record, baseLabel.id, 50);

    expect(cascaded.labelIds).toEqual(['keep']);
    expect(cascaded.note).toBe('annotated');
    expect(cascaded.updatedAt).toBe(50);
  });

  it('identifies empty records without label or note', () => {
    const record = buildTagRecord({
      labelIds: [],
      timestamp: 99
    });

    expect(isTagRecordEmpty(record)).toBe(true);
  });
});
