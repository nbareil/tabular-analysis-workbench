import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import TagNoteDialog from './TagNoteDialog';

describe('TagNoteDialog', () => {
  it('invokes save handler with trimmed note', () => {
    const handleSave = vi.fn();
    const handleClear = vi.fn();
    const handleClose = vi.fn();

    render(
      <TagNoteDialog
        open
        initialLabelId={null}
        initialNote="existing"
        onSave={handleSave}
        onClear={handleClear}
        onClose={handleClose}
      />
    );

    const textarea = screen.getByPlaceholderText('Add context for this row…');
    fireEvent.change(textarea, { target: { value: '  updated note ' } });

    fireEvent.click(screen.getByText('Save note'));

    expect(handleSave).toHaveBeenCalledWith('updated note', null);
  });

  it('invokes clear handler', () => {
    const handleSave = vi.fn();
    const handleClear = vi.fn();
    const handleClose = vi.fn();

    render(
      <TagNoteDialog
        open
        initialLabelId={null}
        initialNote="example"
        onSave={handleSave}
        onClear={handleClear}
        onClose={handleClose}
      />
    );

    fireEvent.click(screen.getByText('Clear note'));
    expect(handleClear).toHaveBeenCalledWith(null);
  });
});
