import { useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { useFocusTrap } from '@/hooks/useFocusTrap';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  widthClassName?: string;
}

/**
 * Accessible dialog: traps Tab focus inside, closes on Escape or backdrop click, and returns focus
 * to whatever was focused before it opened.
 */
export const Modal = ({ title, onClose, children, footer, widthClassName = 'max-w-lg' }: ModalProps): JSX.Element => {
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useFocusTrap(dialogRef);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[10001] flex items-center justify-center bg-slate-950/70 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={`flex max-h-[90vh] w-full ${widthClassName} flex-col rounded border border-slate-700 bg-slate-900 text-sm text-slate-200 shadow-2xl focus:outline-none`}
      >
        <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button type="button" aria-label="Close" className="rounded px-2 text-slate-400 hover:text-slate-100" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="flex-1 overflow-auto px-4 py-3">{children}</div>
        {footer ? <footer className="flex justify-end gap-2 border-t border-slate-800 px-4 py-3">{footer}</footer> : null}
      </div>
    </div>,
    document.body
  );
};
