import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';

import TagPalette from './TagPalette';
import type { LabelDefinition } from '@workers/types';

const mockLabels: LabelDefinition[] = [
  {
    id: 'alpha',
    name: 'Alpha',
    color: '#ff0000',
    description: 'Primary',
    createdAt: 1,
    updatedAt: 1
  },
  {
    id: 'beta',
    name: 'Beta',
    color: '#00ff00',
    createdAt: 2,
    updatedAt: 2
  }
];

describe('TagPalette', () => {
  it('renders labels and reports selection', () => {
    const handleSelect = vi.fn();
    render(
      <TagPalette labels={mockLabels} selectedLabelId={null} onSelect={handleSelect} />
    );

    fireEvent.click(screen.getByRole('button', { name: /alpha/i }));
    expect(handleSelect).toHaveBeenCalledWith('alpha');

    fireEvent.click(screen.getByRole('button', { name: /no label/i }));
    expect(handleSelect).toHaveBeenLastCalledWith(null);
  });

  it('respects the disabled state', () => {
    const handleSelect = vi.fn();
    render(
      <TagPalette
        labels={mockLabels}
        selectedLabelId="beta"
        onSelect={handleSelect}
        disabled
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /beta/i }));
    expect(handleSelect).not.toHaveBeenCalled();
  });
});
