import { fireEvent, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGlobalShortcuts, type GlobalShortcutHandlers } from './useGlobalShortcuts';

const makeHandlers = (): Record<keyof GlobalShortcutHandlers, ReturnType<typeof vi.fn>> => ({
  toggleFilters: vi.fn(),
  addFilter: vi.fn(),
  focusSearch: vi.fn(),
  focusJumpToRow: vi.fn(),
  undo: vi.fn(),
  redo: vi.fn()
});

const press = (target: Element | Document | Window, key: string, init: KeyboardEventInit = {}): boolean =>
  fireEvent.keyDown(target, { key, bubbles: true, cancelable: true, ...init });

const calledHandlers = (handlers: ReturnType<typeof makeHandlers>): string[] =>
  Object.entries(handlers)
    .filter(([, fn]) => fn.mock.calls.length > 0)
    .map(([name]) => name);

describe('useGlobalShortcuts', () => {
  let handlers: ReturnType<typeof makeHandlers>;
  let unmount: () => void;

  beforeEach(() => {
    handlers = makeHandlers();
    ({ unmount } = renderHook(() => useGlobalShortcuts(handlers)));
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it.each([
    ['/', 'focusSearch'],
    ['f', 'toggleFilters'],
    ['F', 'toggleFilters'],
    ['a', 'addFilter'],
    ['g', 'focusJumpToRow']
  ])('"%s" triggers %s and prevents the default action', (key, handler) => {
    const notCancelled = press(document.body, key);
    expect(calledHandlers(handlers)).toEqual([handler]);
    expect(notCancelled).toBe(false);
  });

  it.each(['k', 'K'])('Ctrl/Cmd+%s focuses search', (key) => {
    press(document.body, key, { ctrlKey: true });
    press(document.body, key, { metaKey: true });
    expect(handlers.focusSearch).toHaveBeenCalledTimes(2);
  });

  it('Ctrl/Cmd+K focuses search even while typing in an input', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    press(input, 'k', { ctrlKey: true });
    expect(handlers.focusSearch).toHaveBeenCalledTimes(1);
  });

  it('Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z and Ctrl+Y redo', () => {
    press(document.body, 'z', { ctrlKey: true });
    press(document.body, 'z', { metaKey: true });
    expect(handlers.undo).toHaveBeenCalledTimes(2);
    expect(handlers.redo).not.toHaveBeenCalled();

    press(document.body, 'Z', { ctrlKey: true, shiftKey: true });
    press(document.body, 'z', { metaKey: true, shiftKey: true });
    press(document.body, 'y', { ctrlKey: true });
    expect(handlers.redo).toHaveBeenCalledTimes(3);
    expect(handlers.undo).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['input', () => document.createElement('input')],
    ['textarea', () => document.createElement('textarea')],
    ['select', () => document.createElement('select')],
    [
      'contenteditable child',
      () => {
        const editable = document.createElement('div');
        editable.setAttribute('contenteditable', 'true');
        const child = document.createElement('span');
        editable.appendChild(child);
        document.body.appendChild(editable);
        return child;
      }
    ]
  ])('ignores single-key shortcuts and undo while typing in a %s', (_name, create) => {
    const target = create();
    if (!target.isConnected) {
      document.body.appendChild(target);
    }
    press(target, 'f');
    press(target, '/');
    press(target, 'z', { ctrlKey: true });
    press(target, 'z', { ctrlKey: true, shiftKey: true });
    expect(calledHandlers(handlers)).toEqual([]);
  });

  it('ignores key repeat', () => {
    press(document.body, 'f', { repeat: true });
    press(document.body, 'z', { ctrlKey: true, repeat: true });
    expect(calledHandlers(handlers)).toEqual([]);
  });

  it('ignores events another handler already prevented', () => {
    const event = new KeyboardEvent('keydown', { key: 'f', bubbles: true, cancelable: true });
    event.preventDefault();
    window.dispatchEvent(event);
    expect(handlers.toggleFilters).not.toHaveBeenCalled();
  });

  it.each([
    ['a modal dialog', '<div role="dialog" aria-modal="true"></div>'],
    ['a menu', '<div role="menu"></div>']
  ])('ignores every shortcut while %s is open', (_name, html) => {
    document.body.innerHTML = html;
    press(document.body, 'f');
    press(document.body, 'k', { ctrlKey: true });
    press(document.body, 'z', { ctrlKey: true });
    expect(calledHandlers(handlers)).toEqual([]);
  });

  it('ignores letters combined with other modifiers', () => {
    press(document.body, 'f', { altKey: true });
    press(document.body, 'f', { ctrlKey: true });
    press(document.body, 'a', { metaKey: true });
    expect(calledHandlers(handlers)).toEqual([]);
  });

  it('stops listening on unmount', () => {
    unmount();
    press(document.body, 'f');
    expect(handlers.toggleFilters).not.toHaveBeenCalled();
  });

  it('uses the latest handlers after a re-render', () => {
    unmount();
    const next = makeHandlers();
    const { rerender } = renderHook((props: GlobalShortcutHandlers) => useGlobalShortcuts(props), {
      initialProps: next
    });
    const replaced = makeHandlers();
    rerender(replaced);
    press(document.body, 'g');
    expect(next.focusJumpToRow).not.toHaveBeenCalled();
    expect(replaced.focusJumpToRow).toHaveBeenCalledTimes(1);
  });
});
