import { type JSX, useCallback, useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';

interface MarkdownEditorProps {
  id?: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  placeholder?: string;
  focusOnMount?: boolean;
  onSubmitShortcut?: () => void;
}

const MarkdownEditor = ({
  id,
  value,
  onChange,
  disabled = false,
  placeholder,
  focusOnMount,
  onSubmitShortcut
}: MarkdownEditorProps): JSX.Element => {
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!focusOnMount) {
      return;
    }

    const element = textAreaRef.current;
    if (element) {
      element.focus();
      element.setSelectionRange(element.value.length, element.value.length);
    }
  }, [focusOnMount]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (!onSubmitShortcut) {
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        onSubmitShortcut();
      }
    },
    [onSubmitShortcut]
  );

  return (
    <textarea
      ref={textAreaRef}
      aria-label="Markdown note editor"
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      id={id}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={handleKeyDown}
      className="h-56 w-full rounded border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-50 outline-none focus-visible:border-slate-600 focus-visible:ring-2 focus-visible:ring-slate-500/40"
      style={{ resize: 'vertical' }}
    />
  );
};

export default MarkdownEditor;
