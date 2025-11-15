export interface AutoSaveSchedulerOptions {
  debounceMs: number;
  maxIntervalMs: number;
  save: () => Promise<void> | void;
}

export class AutoSaveScheduler {
  private readonly debounceMs: number;
  private readonly maxIntervalMs: number;
  private readonly saveFn: () => Promise<void> | void;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private pending = false;
  private saving = false;

  constructor(options: AutoSaveSchedulerOptions) {
    this.debounceMs = options.debounceMs;
    this.maxIntervalMs = options.maxIntervalMs;
    this.saveFn = options.save;
  }

  markDirty(): void {
    if (this.disposed) {
      return;
    }

    this.pending = true;
    this.scheduleDebounce();
    this.ensureInterval();
  }

  async flush(): Promise<void> {
    if (this.disposed) {
      return;
    }
    await this.runSave();
  }

  dispose(): void {
    this.disposed = true;
    if (this.debounceTimer) {
      globalThis.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.intervalTimer) {
      globalThis.clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    this.pending = false;
  }

  private scheduleDebounce(): void {
    if (typeof globalThis.setTimeout !== 'function') {
      return;
    }

    if (this.debounceTimer) {
      globalThis.clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = globalThis.setTimeout(() => {
      this.debounceTimer = null;
      void this.runSave();
    }, this.debounceMs);
  }

  private ensureInterval(): void {
    if (typeof globalThis.setInterval !== 'function') {
      return;
    }

    if (this.intervalTimer) {
      return;
    }

    this.intervalTimer = globalThis.setInterval(() => {
      void this.runSave();
    }, this.maxIntervalMs);
  }

  private async runSave(): Promise<void> {
    if (!this.pending || this.saving || this.disposed) {
      return;
    }

    this.pending = false;
    this.saving = true;
    try {
      await this.saveFn();
    } catch (error) {
      // Expose failures via console + re-queue for the next interval.
      console.warn('[auto-save] Failed to persist snapshot', error);
      this.pending = true;
      this.scheduleDebounce();
    } finally {
      this.saving = false;
    }
  }
}
