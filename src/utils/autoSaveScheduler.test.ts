import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import { AutoSaveScheduler } from './autoSaveScheduler';

describe('AutoSaveScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('debounces save calls while ensuring execution after the max interval', async () => {
    const save = vi.fn();
    const scheduler = new AutoSaveScheduler({
      debounceMs: 5_000,
      maxIntervalMs: 60_000,
      save
    });

    scheduler.markDirty();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_500);
    expect(save).toHaveBeenCalledTimes(1);

    // Trigger another dirty state to confirm we debounce again.
    scheduler.markDirty();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(save).toHaveBeenCalledTimes(2);

    scheduler.dispose();
  });

  it('skips unnecessary saves when disposed', async () => {
    const save = vi.fn();
    const scheduler = new AutoSaveScheduler({
      debounceMs: 5_000,
      maxIntervalMs: 60_000,
      save
    });

    scheduler.markDirty();
    scheduler.dispose();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(save).not.toHaveBeenCalled();
  });

  it('retries saves when the callback throws', async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);
    const scheduler = new AutoSaveScheduler({
      debounceMs: 2_000,
      maxIntervalMs: 4_000,
      save
    });

    scheduler.markDirty();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(save).toHaveBeenCalledTimes(1);

    // The failure should re-queue the save, so let the interval fire again.
    await vi.advanceTimersByTimeAsync(4_000);
    expect(save).toHaveBeenCalledTimes(2);

    scheduler.dispose();
  });
});
