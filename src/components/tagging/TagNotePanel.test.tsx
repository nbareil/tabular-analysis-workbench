import { act, fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';

import TagNotePanel from './TagNotePanel';
import { useTagStore } from '@state/tagStore';
import type { LabelDefinition } from '@workers/types';

vi.mock('@components/tagging/MarkdownEditor', () => {
  return {
    __esModule: true,
    default: ({
      value,
      onChange,
      placeholder,
      disabled
    }: {
      value: string;
      onChange: (next: string) => void;
      placeholder?: string;
      disabled?: boolean;
    }) => (
      <textarea
        data-testid="markdown-editor"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    )
  };
});

const storeSnapshot = (() => {
  const state = useTagStore.getState();
  return {
    labels: state.labels,
    status: state.status,
    error: state.error
  };
})();

const sampleLabels: LabelDefinition[] = [
  {
    id: 'critical',
    name: 'Critical',
    color: '#ff5555',
    description: 'Needs attention',
    createdAt: Date.now(),
    updatedAt: Date.now()
  },
  {
    id: 'info',
    name: 'Info',
    color: '#3366ff',
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
];

describe('TagNotePanel', () => {
beforeEach(async () => {
  await act(async () => {
    useTagStore.setState({
      labels: sampleLabels,
      status: 'ready',
      error: null
    });
  });
});

afterEach(async () => {
  await act(async () => {
    useTagStore.setState({
      labels: storeSnapshot.labels,
      status: storeSnapshot.status,
      error: storeSnapshot.error
    });
  });
});

  it('lets users edit markdown notes and choose labels', async () => {
    const handleSave = vi.fn();
    await act(async () => {
      render(
        <TagNotePanel
          open
          rowId={42}
          initialLabelId={null}
          initialNote="**bold**"
          onSave={handleSave}
          onClear={vi.fn()}
          onClose={vi.fn()}
        />
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /critical/i }));
      fireEvent.change(screen.getByPlaceholderText('Add context for this row…'), {
        target: { value: '**bold** status' }
      });
      fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    });

    expect(handleSave).toHaveBeenCalledWith('**bold** status', 'critical');
    expect(screen.getByTestId('note-preview').innerHTML).toContain('<strong>bold</strong>');
  });

  it('passes the current label when clearing notes', async () => {
    const handleClear = vi.fn();
    await act(async () => {
      render(
        <TagNotePanel
          open
          rowId={99}
          initialLabelId="info"
          initialNote="Note content"
          onSave={vi.fn()}
          onClear={handleClear}
          onClose={vi.fn()}
        />
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /clear note/i }));
    });
    expect(handleClear).toHaveBeenCalledWith('info');
  });
});
