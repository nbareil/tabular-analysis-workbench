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
      labelId: baseLabel.id,
      note: 'keep me',
      color: baseLabel.color,
      updatedAt: 10
    };

    const record = buildTagRecord({
      existing,
      label: baseLabel,
      labelId: baseLabel.id,
      timestamp: 20
    });

    expect(record.note).toBe('keep me');
    expect(record.color).toBe(baseLabel.color);
  });

  it('clears note when caller passes an empty string', () => {
    const existing: TagRecord = {
      labelId: baseLabel.id,
      note: 'remove me',
      updatedAt: 5
    };

    const record = buildTagRecord({
      existing,
      label: baseLabel,
      labelId: baseLabel.id,
      note: '',
      timestamp: 10
    });

    expect(record.note).toBeUndefined();
  });

  it('omits color when labelId resolves to null', () => {
    const record = buildTagRecord({
      label: undefined,
      labelId: null,
      timestamp: 2
    });

    expect(record.labelId).toBeNull();
    expect(record.color).toBeUndefined();
  });

  it('cascades label deletion while retaining note content', () => {
    const record: TagRecord = {
      labelId: baseLabel.id,
      note: 'annotated',
      updatedAt: 1
    };

    const cascaded = cascadeLabelDeletion(record, 50);

    expect(cascaded.labelId).toBeNull();
    expect(cascaded.note).toBe('annotated');
    expect(cascaded.updatedAt).toBe(50);
  });

  it('identifies empty records without label or note', () => {
    const record = buildTagRecord({
      labelId: null,
      timestamp: 99
    });

    expect(isTagRecordEmpty(record)).toBe(true);
  });
});
