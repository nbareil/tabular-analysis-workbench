import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

import OptionsPanel from './OptionsPanel';
import { PREFERENCES_STORAGE_KEY, useAppStore } from '@state/appStore';
import { DATA_DEFAULT_FONT_ID, DEFAULT_FONT_ID, DEFAULT_FONT_SIZE, FONT_OPTIONS } from '@constants/fonts';

const renderPanel = (props: Partial<Parameters<typeof OptionsPanel>[0]> = {}) =>
  render(<OptionsPanel open onClose={() => {}} onFlushStoredData={async () => {}} {...props} />);

const storedPreferences = (): Record<string, unknown> =>
  JSON.parse(window.localStorage.getItem(PREFERENCES_STORAGE_KEY) ?? '{}').state ?? {};

describe('OptionsPanel', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useAppStore.setState({
      interfaceFontFamily: DEFAULT_FONT_ID,
      interfaceFontSize: DEFAULT_FONT_SIZE,
      dataFontFamily: DATA_DEFAULT_FONT_ID,
      dataFontSize: DEFAULT_FONT_SIZE
    });
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('stores the display time zone preference', () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText(/display time zone/i), { target: { value: 'UTC' } });
    expect(useAppStore.getState().displayTimeZone).toBe('UTC');
    expect(storedPreferences()).toMatchObject({ displayTimeZone: 'UTC' });
  });

  it('renders nothing when closed', () => {
    renderPanel({ open: false });
    expect(screen.queryByText('Options')).not.toBeInTheDocument();
  });

  it('shows the current font preferences', () => {
    renderPanel();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/interface font/i)).toHaveValue(DEFAULT_FONT_ID);
    expect(screen.getByLabelText(/data font/i)).toHaveValue(DATA_DEFAULT_FONT_ID);
    expect(screen.getByLabelText(/font size \(interface\)/i)).toHaveValue(DEFAULT_FONT_SIZE);
  });

  it('updates font preferences and clamps sizes', () => {
    renderPanel();

    const targetInterface = FONT_OPTIONS.find((option) => option.id !== DEFAULT_FONT_ID)!;
    fireEvent.change(screen.getByLabelText(/interface font/i), { target: { value: targetInterface.id } });
    expect(useAppStore.getState().interfaceFontFamily).toBe(targetInterface.id);

    const targetData = FONT_OPTIONS.find((option) => option.id !== DATA_DEFAULT_FONT_ID)!;
    fireEvent.change(screen.getByLabelText(/data font/i), { target: { value: targetData.id } });
    expect(useAppStore.getState().dataFontFamily).toBe(targetData.id);

    const interfaceSize = screen.getByLabelText(/font size \(interface\)/i);
    fireEvent.change(interfaceSize, { target: { value: '18' } });
    expect(useAppStore.getState().interfaceFontSize).toBe(18);
    fireEvent.change(interfaceSize, { target: { value: '100' } });
    expect(useAppStore.getState().interfaceFontSize).toBe(24);
    fireEvent.change(interfaceSize, { target: { value: '4' } });
    expect(useAppStore.getState().interfaceFontSize).toBe(10);

    fireEvent.change(screen.getByLabelText(/font size \(data\)/i), { target: { value: '20' } });
    expect(useAppStore.getState().dataFontSize).toBe(20);
  });

  it('persists font preferences to localStorage', () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText(/font size \(data\)/i), { target: { value: '16' } });
    const targetInterface = FONT_OPTIONS.find((option) => option.id !== DEFAULT_FONT_ID)!;
    fireEvent.change(screen.getByLabelText(/interface font/i), { target: { value: targetInterface.id } });

    expect(storedPreferences()).toMatchObject({ dataFontSize: 16, interfaceFontFamily: targetInterface.id });
  });

  it('closes on Escape, the Close button and the backdrop, but not on clicks inside', () => {
    const onClose = vi.fn();
    renderPanel({ onClose });

    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('flushes stored data once and shows progress', async () => {
    let finish!: () => void;
    const flush = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    renderPanel({ onFlushStoredData: flush });

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('button', { name: 'Deleting…' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Deleting…' }));

    await act(async () => finish());
    expect(flush).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Reloading…' })).toBeDisabled();
  });

  it('shows the error and re-enables flushing when it fails', async () => {
    const flush = vi.fn().mockRejectedValue(new Error('quota error'));
    renderPanel({ onFlushStoredData: flush });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    });

    expect(screen.getByText('quota error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled();
  });
});
