import { beforeEach, describe, expect, it } from 'vitest';

import { useSessionStore, getSessionSnapshot, type SessionSnapshot } from './sessionStore';
import type { GroupAggregationDefinition, LabelDefinition, TagRecord } from '@workers/types';

const sampleAggregations: GroupAggregationDefinition[] = [
  { operator: 'count', alias: 'rows' }
];

const sampleLabels: LabelDefinition[] = [
  {
    id: 'label-1',
    name: 'Interesting',
    color: '#ff6600',
    description: 'Needs follow-up',
    createdAt: 1,
    updatedAt: 1
  }
];

const sampleTags: Record<number, TagRecord> = {
  42: {
    labelIds: ['label-1'],
    note: 'Check authentication timeline',
    updatedAt: 2
  }
};

const buildSnapshot = (): SessionSnapshot => ({
  fileHandle: null,
  filters: [
    {
      id: 'filter-1',
      column: 'event_type',
      operator: 'eq',
      value: 'logon',
      rawValue: 'logon',
      fuzzy: false,
      caseSensitive: false,
      enabled: true
    }
  ],
  sorts: [{ column: 'timestamp', direction: 'desc' }],
  groups: ['user'],
  groupAggregations: sampleAggregations,
  columnLayout: {
    order: ['timestamp', 'user', 'event_type'],
    visibility: {
      timestamp: true,
      user: true,
      event_type: true
    }
  },
  searchCaseSensitive: true,
  interfaceFontFamily: 'inter',
  interfaceFontSize: 14,
  dataFontFamily: 'jetbrains-mono',
  dataFontSize: 12,
  labels: sampleLabels,
  tags: sampleTags,
  updatedAt: 123456789
});

describe('sessionStore', () => {
  beforeEach(() => {
    useSessionStore.getState().clear();
  });

  it('hydrates persisted snapshot into store state', () => {
    const snapshot = buildSnapshot();
    useSessionStore.getState().hydrate(snapshot);

    const state = useSessionStore.getState();
    expect(state.filters).toEqual(snapshot.filters);
    expect(state.columnLayout.order).toEqual(snapshot.columnLayout.order);
    expect(state.groupAggregations).toEqual(sampleAggregations);
    expect(state.labels).toEqual(sampleLabels);
    expect(state.tags).toEqual(sampleTags);
  });

  it('produces serialisable snapshot via helper', () => {
    const snapshot = buildSnapshot();
    useSessionStore.getState().hydrate(snapshot);

    const exported = getSessionSnapshot();
    expect(exported).toStrictEqual({
      ...snapshot,
      fileHandle: null
    });
    expect((exported as unknown as Record<string, unknown>).setFileHandle).toBeUndefined();
  });
});
