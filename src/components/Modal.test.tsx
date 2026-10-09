import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Modal } from './Modal';

const Harness = ({ onClose }: { onClose?: () => void }) => {
  const [open, setOpen] = useState(false);
  const close = () => {
    onClose?.();
    setOpen(false);
  };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {open ? (
        <Modal title="Settings" onClose={close} footer={<button type="button">Save</button>}>
          <input aria-label="Name" />
        </Modal>
      ) : null}
    </>
  );
};

describe('Modal', () => {
  it('renders an accessible modal dialog', () => {
    render(
      <Modal title="Settings" onClose={() => {}}>
        <p>Body</p>
      </Modal>
    );
    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('Body')).toBeInTheDocument();
  });

  it('moves focus inside on open, preferring [data-autofocus]', () => {
    render(
      <Modal title="Settings" onClose={() => {}}>
        <input aria-label="First" />
        <input aria-label="Second" data-autofocus />
      </Modal>
    );
    expect(screen.getByLabelText('Second')).toHaveFocus();
  });

  it('focuses the first focusable element when nothing is marked autofocus', () => {
    render(
      <Modal title="Settings" onClose={() => {}}>
        <input aria-label="Name" />
      </Modal>
    );
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });

  it('traps Tab and Shift+Tab inside the dialog', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await act(() => user.click(screen.getByRole('button', { name: 'Open' })));

    const close = screen.getByRole('button', { name: 'Close' });
    const save = screen.getByRole('button', { name: 'Save' });
    expect(close).toHaveFocus();

    await user.tab();
    expect(screen.getByLabelText('Name')).toHaveFocus();
    await user.tab();
    expect(save).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(save).toHaveFocus();
  });

  it('closes on Escape without letting the key reach outer handlers', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const outer = vi.fn();
    render(
      <div onKeyDown={outer}>
        <Harness onClose={onClose} />
      </div>
    );
    await act(() => user.click(screen.getByRole('button', { name: 'Open' })));
    outer.mockClear();

    await act(() => user.keyboard('{Escape}'));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes on a backdrop click but not on clicks inside the dialog', () => {
    const onClose = vi.fn();
    render(
      <Modal title="Settings" onClose={onClose}>
        <p>Body</p>
      </Modal>
    );
    fireEvent.click(screen.getByText('Body'));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Close Settings' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes via the Close button', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal title="Settings" onClose={onClose}>
        <p>Body</p>
      </Modal>
    );
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('restores focus to the opener after closing', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open' });
    await act(() => user.click(opener));
    expect(opener).not.toHaveFocus();

    await act(() => user.keyboard('{Escape}'));

    expect(opener).toHaveFocus();
  });
});
