export interface FontOption {
  id: string;
  label: string;
  stack: string;
  description?: string;
}

export const FONT_OPTIONS: FontOption[] = [
  {
    id: 'inter',
    label: 'Inter (default)',
    stack: "'Inter', system-ui, sans-serif",
    description: 'Modern sans-serif tuned for UI readability.'
  },
  {
    id: 'system-sans',
    label: 'System sans-serif',
    stack: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    description: "Respect the operating system's default UI font."
  },
  {
    id: 'jetbrains-mono',
    label: 'JetBrains Mono',
    stack: "'JetBrains Mono', 'Fira Code', 'SFMono-Regular', monospace",
    description: 'Monospaced option for log-style alignment.'
  }
];

export const DEFAULT_FONT_ID = FONT_OPTIONS[0]!.id;
export const DATA_DEFAULT_FONT_ID = FONT_OPTIONS[2] ? FONT_OPTIONS[2]!.id : FONT_OPTIONS[0]!.id;

export const getFontOption = (id: string): FontOption => {
  return FONT_OPTIONS.find((option) => option.id === id) ?? FONT_OPTIONS[0]!;
};

export const getFontStack = (id: string): string => getFontOption(id).stack;

export const DEFAULT_FONT_SIZE = 14;

export const clampFontSize = (value: number, { min = 10, max = 24 } = {}): number => {
  if (Number.isNaN(value)) {
    return DEFAULT_FONT_SIZE;
  }

  if (value < min) {
    return min;
  }

  if (value > max) {
    return max;
  }

  return Math.round(value);
};
