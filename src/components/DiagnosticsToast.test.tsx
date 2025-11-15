import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import DiagnosticsToast from './DiagnosticsToast';

const buildDetails = () => ({
  message: 'Failed to fetch rows',
  timestamp: Date.now(),
  payload: {
    operation: 'grid.fetch',
    retry: vi.fn().mockResolvedValue(undefined)
  }
});

describe('DiagnosticsToast', () => {
  it('renders message and triggers callbacks', async () => {
    const details = buildDetails();
    const onDismiss = vi.fn();
    const onDownload = vi.fn();
    render(<DiagnosticsToast details={details} onDismiss={onDismiss} onDownload={onDownload} />);

    expect(screen.getByText('Failed to fetch rows')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Download diagnostics'));
    expect(onDownload).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('Retry'));
    expect(details.payload.retry).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onDismiss).toHaveBeenCalled());
  });
});
