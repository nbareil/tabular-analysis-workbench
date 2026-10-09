import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { GridMenu, MenuItem, MenuSection } from './GridMenu';

const renderMenu = (onClose = vi.fn(), onCopy = vi.fn()) => {
  render(
    <GridMenu label="Cell actions" x={10} y={20} onClose={onClose}>
      <MenuSection title="Filter">
        <MenuItem>Filter equals</MenuItem>
        <MenuItem disabled>Unavailable</MenuItem>
        <MenuItem>Filter not equals</MenuItem>
      </MenuSection>
      <MenuSection title="Clipboard">
        <MenuItem onClick={onCopy}>Copy</MenuItem>
      </MenuSection>
    </GridMenu>
  );
  return { onClose, onCopy };
};

const item = (name: string) => screen.getByRole('menuitem', { name });

describe('GridMenu', () => {
  it('renders a labelled menu at the requested position with grouped items', () => {
    renderMenu();
    const menu = screen.getByRole('menu', { name: 'Cell actions' });
    expect(menu).toHaveStyle({ top: '20px', left: '10px' });
    expect(screen.getByRole('group', { name: 'Filter' })).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem')).toHaveLength(4);
  });

  it('focuses the first enabled item on open', () => {
    renderMenu();
    expect(item('Filter equals')).toHaveFocus();
  });

  it('moves focus with arrow keys, skipping disabled items and wrapping around', async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.keyboard('{ArrowDown}');
    expect(item('Filter not equals')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(item('Copy')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(item('Filter equals')).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(item('Copy')).toHaveFocus();
  });

  it('jumps to the first and last item with Home and End', async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.keyboard('{End}');
    expect(item('Copy')).toHaveFocus();
    await user.keyboard('{Home}');
    expect(item('Filter equals')).toHaveFocus();
  });

  it.each(['{Escape}', '{Tab}'])('closes on %s', async (key) => {
    const user = userEvent.setup();
    const { onClose } = renderMenu();
    await user.keyboard(key);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps handled keys from reaching outer listeners but lets others through', () => {
    const outer = vi.fn();
    render(
      <div onKeyDown={outer}>
        <GridMenu label="Menu" x={0} y={0} onClose={() => {}}>
          <MenuItem>One</MenuItem>
        </GridMenu>
      </div>
    );
    fireEvent.keyDown(item('One'), { key: 'ArrowDown' });
    fireEvent.keyDown(item('One'), { key: 'Escape' });
    expect(outer).not.toHaveBeenCalled();

    fireEvent.keyDown(item('One'), { key: 'x' });
    expect(outer).toHaveBeenCalledTimes(1);
  });

  it('activates items with Enter', async () => {
    const user = userEvent.setup();
    const { onCopy } = renderMenu();
    await user.keyboard('{End}{Enter}');
    expect(onCopy).toHaveBeenCalledTimes(1);
  });

  it('stops mousedown from propagating so outside-click handlers keep it open', () => {
    const outside = vi.fn();
    document.addEventListener('mousedown', outside);
    render(
      <GridMenu label="Menu" x={0} y={0} onClose={() => {}}>
        <MenuItem>One</MenuItem>
      </GridMenu>
    );
    fireEvent.mouseDown(item('One'));
    document.removeEventListener('mousedown', outside);
    expect(outside).not.toHaveBeenCalled();
  });
});
