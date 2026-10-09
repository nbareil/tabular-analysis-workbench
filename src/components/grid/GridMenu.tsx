import { type JSX, useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const ITEM_SELECTOR = '[role="menuitem"]:not([disabled]), [role="menuitemcheckbox"]:not([disabled])';

interface GridMenuProps {
  label: string;
  x: number;
  y: number;
  className?: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Floating context menu with WAI-ARIA menu semantics: focus moves to the first item on open,
 * arrow keys / Home / End move between items, Escape and Tab close it.
 */
export const GridMenu = ({ label, x, y, className = '', onClose, children }: GridMenuProps): JSX.Element => {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(ITEM_SELECTOR)?.focus();
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    const focusAt = (next: number) => {
      event.preventDefault();
      items[(next + items.length) % items.length]?.focus();
    };
    switch (event.key) {
      case 'ArrowDown':
        focusAt(index + 1);
        break;
      case 'ArrowUp':
        focusAt(index - 1);
        break;
      case 'Home':
        focusAt(0);
        break;
      case 'End':
        focusAt(items.length - 1);
        break;
      case 'Escape':
      case 'Tab':
        event.preventDefault();
        onClose();
        break;
      default:
        return;
    }
    event.stopPropagation();
  };

  return createPortal(
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      aria-label={label}
      data-grid-context-menu="true"
      className={`fixed z-10000 rounded-sm border border-slate-700 bg-slate-900 p-1 text-xs text-slate-200 shadow-xl ${className}`}
      style={{ top: y, left: x }}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={handleKeyDown}
    >
      {children}
    </div>,
    document.body
  );
};

export const MenuSection = ({ title, children }: { title: string; children: ReactNode }): JSX.Element => (
  <div role="group" aria-label={title} className="mt-1 border-t border-slate-800 pt-1 first:mt-0 first:border-t-0 first:pt-0">
    <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-slate-400" aria-hidden>
      {title}
    </div>
    {children}
  </div>
);

export const MenuItem = ({
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element => (
  <button
    type="button"
    role="menuitem"
    className={`flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left hover:bg-slate-800 focus:bg-slate-800 focus:outline-hidden disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    {...props}
  >
    {children}
  </button>
);
