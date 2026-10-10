import { expect, test, trickyCsv, trickyJsonl, type PickerWindow } from './fixtures';

test('loads a CSV with malformed and tricky rows', async ({ workbench, page }) => {
  await workbench.open(trickyCsv());

  await expect(workbench.status).toContainText('Showing 2,005 of 2,005 rows');
  await expect(workbench.status).toContainText('2 malformed rows');
  await expect(page.locator('.ag-header-cell[col-id="user_2"]')).toContainText('user_2');
  for (const text of ['12" disk inserted', 'Logon, interactive', '007', '=cmd|calc']) {
    await expect(page.getByText(text, { exact: true })).toBeVisible();
  }
});

test('loads JSON Lines with nested keys, exact numbers and a malformed line', async ({ workbench, page }) => {
  await workbench.open(trickyJsonl(), 'events.jsonl');

  await expect(workbench.status).toContainText('Showing 2,003 of 2,003 rows');
  await expect(workbench.status).toContainText('1 malformed rows');
  await expect(workbench.cell(0, 'process.parent.pid')).toHaveText('4');
  await expect(workbench.cell(0, 'flow_id')).toHaveText('1234567890123456789');
  await expect(workbench.cell(0, 'tags')).toHaveText('["a","b"]');
  await expect(workbench.cell(1, 'process.command_line')).toHaveText('cmd.exe /c "C:\\Temp\\x.bat"');

  await page.getByLabel('Search visible columns').fill('needle');
  await expect(workbench.status).toContainText('Showing 1 of 2,003 rows');
  await page.getByLabel('Search visible columns').fill('truncated');
  await expect(workbench.status).toContainText('Showing 1 of 2,003 rows');
  // malformed_line is the last column, beyond the viewport.
  await page.locator('.ag-body-horizontal-scroll-viewport').evaluate((viewport) => (viewport.scrollLeft = viewport.scrollWidth));
  await expect(workbench.cell(0, 'malformed_line')).toHaveText('{"@timestamp":"2024-01-01T10:06:00Z","truncated":');
});

test('a JSON document is rejected with a hint to convert it', async ({ workbench, page }) => {
  await workbench.writeOpfsFile('export.json', '[{"a":1},\n{"a":2}]\n');
  await page.evaluate(() => ((window as unknown as PickerWindow).__pickerFile = 'export.json'));
  await page.getByRole('button', { name: 'Open Files' }).click();

  await expect(workbench.status).toContainText('export.json is a JSON document, not JSON Lines');
  await expect(page.getByRole('button', { name: 'Open Files' })).toBeEnabled();
});

test('merges several files with a source_file column', async ({ workbench, page }) => {
  await workbench.writeOpfsFile('a.csv', 'host,event\nWS01,one\n');
  await workbench.writeOpfsFile('b.csv', 'host,event\nWS02,two\nWS03,three\n');
  await page.evaluate(() => {
    (window as unknown as PickerWindow).showOpenFilePicker = async () => {
      const root = await navigator.storage.getDirectory();
      return [await root.getFileHandle('a.csv'), await root.getFileHandle('b.csv')];
    };
  });
  await page.getByRole('button', { name: 'Open Files' }).click();

  await expect(workbench.status).toContainText('Showing 3 of 3 rows');
  await expect(workbench.header('source_file')).toBeVisible();
  await expect(page.getByText('b.csv', { exact: true }).first()).toBeVisible();
});

test('cancelling the file picker is silent', async ({ workbench, page }) => {
  await page.evaluate(() => ((window as unknown as PickerWindow).__pickerError = 'AbortError'));
  await page.getByRole('button', { name: 'Open Files' }).click();

  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(workbench.status).toContainText('Open a CSV, TSV or JSON Lines file to begin.');
});

test('a denied file permission is reported', async ({ workbench, page }) => {
  await page.evaluate(() => ((window as unknown as PickerWindow).__pickerError = 'NotAllowedError'));
  await page.getByRole('button', { name: 'Open Files' }).click();

  await expect(page.getByRole('alert')).toContainText('Picker failed');
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(workbench.status).toContainText('Open a CSV, TSV or JSON Lines file to begin.');
});

test('an unreadable file fails the load with its reason', async ({ workbench, page }) => {
  await workbench.writeOpfsFile('gone.csv', 'a\n1\n');
  await page.evaluate(async () => {
    const handle = await (await navigator.storage.getDirectory()).getFileHandle('gone.csv');
    await (await navigator.storage.getDirectory()).removeEntry('gone.csv');
    (window as unknown as PickerWindow).showOpenFilePicker = async () => [handle];
  });
  await page.getByRole('button', { name: 'Open Files' }).click();

  await expect(workbench.status).toContainText(/not found|could not be found/i);
  await expect(page.getByRole('button', { name: 'Open Files' })).toBeEnabled();
});
