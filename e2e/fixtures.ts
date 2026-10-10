import { test as base, expect, type Page } from '@playwright/test';

/**
 * Edge cases the parser and grid must survive: duplicate header, offset/naive/µs timestamps,
 * stray quote, quoted newline, blank line, extra field, short row, formula, leading zeros.
 */
export const trickyCsv = (bulkRows = 2000): string => {
  const lines = [
    'timestamp,host,event,user,user,size,id',
    '2024-01-01 10:00:00,WS01,"Logon, interactive",alice,dup1,100,007',
    '2024-01-01T09:30:00+02:00,WS02,12" disk inserted,bob,dup2,-5,008',
    '',
    '2024-01-01 10:05:00.123456,WS01,"multi\nline note",carol,dup3,=cmd|calc,009',
    '2024-01-02 00:00:00,WS03,Event 4624,dave,dup4,250,010,EXTRA',
    '2024-01-01 10:05:00.123,WS02,short row'
  ];
  for (let i = 0; i < bulkRows; i += 1) {
    const minute = String(i % 60).padStart(2, '0');
    const hour = String(Math.floor(i / 60) % 24).padStart(2, '0');
    lines.push(`2024-01-03 ${hour}:${minute}:00,WS0${i % 5},bulk event ${i},user${i % 7},x,${i},${String(i).padStart(4, '0')}`);
  }
  return `${lines.join('\n')}\n`;
};

/**
 * JSON Lines edge cases: nested keys, an array, a 19-digit id, escapes, a key only one row has,
 * a blank line and a truncated record.
 */
export const trickyJsonl = (bulkRows = 2000): string => {
  const lines = [
    '{"@timestamp":"2024-01-01T10:00:00Z","host":{"name":"WS01"},"process":{"pid":4242,"parent":{"pid":4}},"flow_id":1234567890123456789,"tags":["a","b"]}',
    '',
    '{"@timestamp":"2024-01-01T10:05:00Z","host":{"name":"WS02"},"process":{"pid":7,"command_line":"cmd.exe /c \\"C:\\\\Temp\\\\x.bat\\""},"rare":"needle"}',
    '{"@timestamp":"2024-01-01T10:06:00Z","truncated":'
  ];
  for (let i = 0; i < bulkRows; i += 1) {
    const ts = new Date(Date.UTC(2024, 0, 3) + i * 60_000).toISOString();
    lines.push(JSON.stringify({ '@timestamp': ts, host: { name: `WS0${i % 5}` }, process: { pid: 1000 + i }, event: `bulk ${i}` }));
  }
  return `${lines.join('\n')}\n`;
};

/** The window as the init script below patches it. */
export type PickerWindow = {
  showOpenFilePicker: (options?: unknown) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker: (options?: { suggestedName?: string }) => Promise<FileSystemFileHandle>;
  __pickerFile?: string;
  __pickerError?: string;
  __savedFile?: string;
};

export class Workbench {
  constructor(readonly page: Page) {}

  /** Writes `text` to OPFS as `name` and opens it through the (stubbed) file picker. */
  async open(text: string, name = 'fixture.csv'): Promise<void> {
    await this.writeOpfsFile(name, text);
    await this.reopen(name);
  }

  /** Opens a file already in OPFS. Rewriting it would change its modification time and identity. */
  async reopen(name = 'fixture.csv'): Promise<void> {
    await this.page.evaluate((fileName) => {
      (window as unknown as PickerWindow).__pickerFile = fileName;
    }, name);
    await this.page.getByRole('button', { name: 'Open Files' }).click();
    await expect(this.status).toContainText(/Showing [\d,]+ of [\d,]+ rows/, { timeout: 20_000 });
  }

  async writeOpfsFile(name: string, text: string): Promise<void> {
    await this.page.evaluate(
      async ([fileName, contents]) => {
        const handle = await (await navigator.storage.getDirectory()).getFileHandle(fileName, { create: true });
        const writable = await handle.createWritable();
        await writable.write(contents);
        await writable.close();
      },
      [name, text] as const
    );
  }

  /** Text of the file the app last saved through the (stubbed) save picker. */
  async savedFile(): Promise<{ name: string; text: string }> {
    const handle = this.page.waitForFunction(() => (window as unknown as PickerWindow).__savedFile);
    const name = (await (await handle).jsonValue()) as string;
    const text = await this.page.evaluate(async (fileName) => {
      const root = await navigator.storage.getDirectory();
      return (await (await root.getFileHandle(fileName)).getFile()).text();
    }, name);
    await this.page.evaluate(() => delete (window as unknown as PickerWindow).__savedFile);
    return { name, text };
  }

  get status() {
    return this.page.locator('footer').last();
  }

  cell(row: number, column: string) {
    return this.page.locator(`.ag-row[row-index="${row}"] [col-id="${column}"]`).first();
  }

  header(column: string) {
    return this.page.locator(`.ag-header-cell[col-id="${column}"]`);
  }

  /** The filter sidebar starts collapsed. */
  async showFilters(): Promise<void> {
    await this.page.getByRole('button', { name: 'Expand filters panel' }).click();
  }

  async headerMenu(column: string): Promise<void> {
    await this.page.getByRole('button', { name: `Open ${column} menu` }).click();
  }
}

/**
 * Native file pickers cannot be driven headlessly, so they are replaced with OPFS handles:
 * `showOpenFilePicker` returns `window.__pickerFile` (or rejects with `window.__pickerError`),
 * `showSaveFilePicker` creates `saved-<suggestedName>` and records it in `window.__savedFile`.
 */
export const test = base.extend<{ workbench: Workbench }>({
  workbench: async ({ page }, use) => {
    await page.addInitScript(() => {
      const w = window as unknown as PickerWindow;
      w.showOpenFilePicker = async () => {
        if (w.__pickerError) {
          throw new DOMException('Picker failed', w.__pickerError);
        }
        return [await (await navigator.storage.getDirectory()).getFileHandle(w.__pickerFile ?? 'fixture.csv')];
      };
      w.showSaveFilePicker = async (options) => {
        const name = `saved-${options?.suggestedName ?? 'export'}`;
        const handle = await (await navigator.storage.getDirectory()).getFileHandle(name, { create: true });
        const writable = handle.createWritable.bind(handle);
        // Record the name once the app has finished writing.
        return Object.assign(handle, {
          createWritable: async (...args: Parameters<typeof writable>) => {
            const stream = await writable(...args);
            const close = stream.close.bind(stream);
            return Object.assign(stream, {
              close: async () => {
                await close();
                w.__savedFile = name;
              }
            });
          }
        });
      };
    });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto('');
    await use(new Workbench(page));
    expect(pageErrors, 'uncaught errors in the page').toEqual([]);
  }
});

export { expect };
