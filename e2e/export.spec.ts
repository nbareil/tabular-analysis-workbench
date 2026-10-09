import { expect, test, trickyCsv } from './fixtures';

test('exports the filtered view with formulas neutralised', async ({ workbench, page }) => {
  await workbench.open(trickyCsv());
  await workbench.headerMenu('host');
  await page.getByRole('menuitemcheckbox', { name: /WS01/ }).click();
  await page.keyboard.press('Escape');
  await expect(workbench.status).toContainText('Showing 402 of');

  await page.getByRole('button', { name: /Export/ }).click();
  await page.getByRole('group', { name: 'Rows in current view' }).getByRole('menuitem', { name: '.csv', exact: true }).click();
  const { text } = await workbench.savedFile();

  const lines = text.trimEnd().split('\n');
  expect(lines[0]).toBe('"timestamp","host","event","user","user_2","size","id"');
  expect(text).toContain('"\'=cmd|calc"');
  expect(text).toContain('"multi\nline note"');
  expect(lines.length).toBe(1 + 402 + 1); // header, rows, the extra physical line of the multiline cell
});

test('exports all labelled rows regardless of filters', async ({ workbench, page }) => {
  await workbench.open(trickyCsv(20));
  await workbench.cell(0, '__tag').click({ button: 'right' });
  await page.getByRole('menu', { name: 'Cell actions' }).getByRole('menuitem', { name: 'Impact' }).click();
  await expect(workbench.cell(0, '__tag')).toHaveText('Impact');

  await page.getByLabel('Search visible columns').fill('no such value');
  await expect(workbench.status).toContainText('Showing 0 of');

  await page.getByRole('button', { name: /Export/ }).click();
  await page.getByRole('group', { name: 'All labelled rows (ignores filters)' }).getByRole('menuitem', { name: '.csv', exact: true }).click();
  const { text } = await workbench.savedFile();
  expect(text.trimEnd().split('\n')).toEqual([
    '"timestamp","host","event","user","user_2","size","id","labels","note"',
    '"2024-01-01 10:00:00","WS01","Logon, interactive","alice","dup1","100","007","Impact",""'
  ]);
});
