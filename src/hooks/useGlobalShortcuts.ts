import { useEffect, useRef } from 'react';

export interface GlobalShortcutHandlers {
  toggleFilters: () => void;
  addFilter: () => void;
  focusSearch: () => void;
  focusJumpToRow: () => void;
  undo: () => void;
  redo: () => void;
}

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"]') != null;

/** True while a dialog or context menu owns the keyboard. */
const overlayOpen = (): boolean => document.querySelector('[aria-modal="true"], [role="menu"]') != null;

/**
 * App-wide keyboard shortcuts:
 * - `/` or Ctrl/Cmd+K: focus search
 * - `f`: toggle the filter panel; `a`: add a filter; `g`: jump to a row number
 * - Ctrl/Cmd+Z: undo; Ctrl/Cmd+Shift+Z or Ctrl+Y: redo (filter and label edits)
 *
 * Shortcuts are ignored while typing in a field, while a dialog or menu is open, and on key repeat.
 */
export const useGlobalShortcuts = (handlers: GlobalShortcutHandlers): void => {
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || overlayOpen()) {
        return;
      }
      const current = handlersRef.current;
      const key = event.key.toLowerCase();
      const modifier = event.metaKey || event.ctrlKey;

      if (modifier && key === 'k') {
        event.preventDefault();
        current.focusSearch();
        return;
      }
      if (isTyping(event.target)) {
        return;
      }
      if (modifier && (key === 'y' || (key === 'z' && event.shiftKey))) {
        event.preventDefault();
        current.redo();
        return;
      }
      if (modifier && key === 'z') {
        event.preventDefault();
        current.undo();
        return;
      }
      if (modifier || event.altKey) {
        return;
      }

      const action = { '/': current.focusSearch, f: current.toggleFilters, a: current.addFilter, g: current.focusJumpToRow }[key];
      if (action) {
        event.preventDefault();
        action();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
};
