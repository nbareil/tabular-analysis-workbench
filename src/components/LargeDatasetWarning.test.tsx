import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LargeDatasetWarning } from './LargeDatasetWarning';

describe('LargeDatasetWarning', () => {
  it('renders null when below threshold', () => {
    const { container } = render(
      <LargeDatasetWarning estimatedBytes={100} thresholdBytes={200} onOpenOptions={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows warning and triggers callback', () => {
    const onOpen = vi.fn();
    render(
      <LargeDatasetWarning
        estimatedBytes={800 * 1024 * 1024}
        thresholdBytes={600 * 1024 * 1024}
        onOpenOptions={onOpen}
      />
    );

    expect(screen.getByText(/Large dataset detected/i)).toBeInTheDocument();
    const button = screen.getByRole('button', { name: /Options/i });
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
