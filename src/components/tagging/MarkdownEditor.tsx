import { useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, placeholder as placeholderExtension, keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';

interface MarkdownEditorProps {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  onSubmitShortcut?: () => void;
}

const editorTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: 'transparent',
      border: '1px solid #0f172a',
      borderRadius: '0.375rem',
      fontFamily: 'var(--data-font-family, ui-monospace)',
      fontSize: '0.875rem'
    },
    '&.cm-editor.cm-focused': {
      outline: '2px solid rgba(148, 163, 184, 0.4)',
      outlineOffset: '1px'
    },
    '.cm-content': {
      padding: '0.5rem 0.75rem',
      minHeight: '14rem'
    },
    '.cm-scroller': {
      lineHeight: '1.5'
    },
    '.cm-placeholder': {
      color: 'rgba(148, 163, 184, 0.9)'
    }
  },
  { dark: true }
);

const MarkdownEditor = ({
  value,
  onChange,
  disabled = false,
  placeholder,
  autoFocus,
  onSubmitShortcut
}: MarkdownEditorProps): JSX.Element => {
  const extensions = useMemo(() => {
    const base = [markdown(), EditorView.lineWrapping, keymap.of([indentWithTab]), editorTheme];

    if (placeholder) {
      base.push(placeholderExtension(placeholder));
    }

    if (onSubmitShortcut) {
      base.push(
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              onSubmitShortcut();
              return true;
            }
          }
        ])
      );
    }

    return base;
  }, [onSubmitShortcut, placeholder]);

  return (
    <CodeMirror
      aria-label="Markdown note editor"
      value={value}
      height="14rem"
      minHeight="14rem"
      editable={!disabled}
      basicSetup={{
        lineNumbers: false,
        foldGutter: false,
        highlightActiveLine: false,
        highlightActiveLineGutter: false
      }}
      autoFocus={autoFocus}
      onChange={(next) => onChange(next)}
      extensions={extensions}
      theme={oneDark}
    />
  );
};

export default MarkdownEditor;
