import { useEffect, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * While `active`, moves focus into the container (preferring `[data-autofocus]`), keeps Tab and
 * Shift+Tab cycling inside it, and returns focus to the previously focused element on release.
 */
export const useFocusTrap = (ref: RefObject<HTMLElement>, active = true): void => {
  useEffect(() => {
    const container = ref.current;
    if (!active || !container) {
      return undefined;
    }
    const previous = document.activeElement as HTMLElement | null;
    (container.querySelector<HTMLElement>('[data-autofocus]') ?? container.querySelector<HTMLElement>(FOCUSABLE) ?? container).focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') {
        return;
      }
      const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    container.addEventListener('keydown', handleKeyDown);
    return () => {
      container.removeEventListener('keydown', handleKeyDown);
      previous?.focus?.();
    };
  }, [active, ref]);
};
