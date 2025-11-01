import { describe, expect, it, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import OptionsPanel from './OptionsPanel';
import { useSessionStore } from '@state/sessionStore';
import {
  DEFAULT_FONT_ID,
  DEFAULT_FONT_SIZE,
  FONT_OPTIONS
} from '@constants/fonts';

describe('OptionsPanel', () => {
  beforeEach(() => {
    useSessionStore.setState({
      interfaceFontFamily: DEFAULT_FONT_ID,
      interfaceFontSize: DEFAULT_FONT_SIZE,
      dataFontFamily: DEFAULT_FONT_ID,
      dataFontSize: DEFAULT_FONT_SIZE
    });
  });

  it('renders font options when open', () => {
    render(<OptionsPanel open onClose={() => {}} />);

    expect(screen.getByText('Options')).toBeInTheDocument();
    const select = screen.getByLabelText(/interface font/i);
    expect(select).toBeInTheDocument();
    expect(select).toHaveValue(DEFAULT_FONT_ID);
  });

  it('updates font preference through the dropdown', () => {
    const { unmount } = render(<OptionsPanel open onClose={() => {}} />);

    const interfaceSelect = screen.getByLabelText(/interface font/i);
    const dataSelect = screen.getByLabelText(/data font/i);
    const interfaceSizeInput = screen.getByLabelText(/font size \(interface\)/i) as HTMLInputElement;
    const dataSizeInput = screen.getByLabelText(/font size \(data\)/i) as HTMLInputElement;

    const targetInterface = FONT_OPTIONS.find((option) => option.id !== DEFAULT_FONT_ID)!;
    fireEvent.change(interfaceSelect, { target: { value: targetInterface.id } });

    expect(useSessionStore.getState().interfaceFontFamily).toBe(targetInterface.id);

    const targetData = FONT_OPTIONS.find((option) => option.id !== targetInterface.id)!;
    fireEvent.change(dataSelect, { target: { value: targetData.id } });
    expect(useSessionStore.getState().dataFontFamily).toBe(targetData.id);

    fireEvent.change(interfaceSizeInput, { target: { value: '18' } });
    expect(useSessionStore.getState().interfaceFontSize).toBe(18);

    fireEvent.change(interfaceSizeInput, { target: { value: '100' } });
    expect(useSessionStore.getState().interfaceFontSize).toBe(24);

    fireEvent.change(interfaceSizeInput, { target: { value: '4' } });
    expect(useSessionStore.getState().interfaceFontSize).toBe(10);

    fireEvent.change(dataSizeInput, { target: { value: '20' } });
    expect(useSessionStore.getState().dataFontSize).toBe(20);

    unmount();
  });
});
