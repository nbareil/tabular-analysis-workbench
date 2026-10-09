import { expect, test, trickyCsv } from './fixtures';

test.beforeEach(async ({ workbench }) => {
  await workbench.open(trickyCsv());
});

test('sorts timestamps by instant, not by text', async ({ workbench }) => {
  await workbench.header('timestamp').getByRole('button').first().click();
  // 09:30+02:00 is 07:30Z, earlier than the naive (UTC) 10:00.
  await expect(workbench.cell(0, 'timestamp')).toHaveText('2024-01-01T09:30:00+02:00');
  await workbench.header('timestamp').getByRole('button').first().click();
  await expect(workbench.cell(0, 'timestamp')).toHaveText('2024-01-03 23:59:00');
});

test('global search narrows rows and highlights matches', async ({ workbench, page }) => {
  await page.getByLabel('Search visible columns').fill('DISK');
  await expect(workbench.status).toContainText('Showing 1 of 2,005 rows');
  await expect(page.locator('mark')).toHaveText(['disk']);

  await page.getByLabel('Case sensitive').check();
  await expect(workbench.status).toContainText('Showing 0 of 2,005 rows');

  await page.getByLabel('Search visible columns').fill('');
  await expect(workbench.status).toContainText('Showing 2,005 of 2,005 rows');
});

test('value counts filter, filter builder and undo', async ({ workbench, page }) => {
  await workbench.headerMenu('host');
  await page.getByRole('menuitemcheckbox', { name: /WS01/ }).click();
  await expect(workbench.status).toContainText('Showing 402 of 2,005 rows');
  await page.keyboard.press('Escape');

  await workbench.showFilters();
  await expect(page.getByText('Matches 402 rows')).toBeVisible();

  await page.locator('h1').click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(workbench.status).toContainText('Showing 2,005 of 2,005 rows');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(workbench.status).toContainText('Showing 402 of 2,005 rows');
});

test('equality filter with a typo offers an exact suggestion', async ({ workbench, page }) => {
  await workbench.showFilters();
  await page.getByRole('button', { name: 'Add Filter' }).click();
  await page.getByLabel('Filter column').selectOption('host');
  await page.getByLabel('Filter operator').selectOption('eq');
  await page.getByLabel('Filter value').fill('WS0l');
  await expect(workbench.status).toContainText('Showing 0 of 2,005 rows');

  await page.getByRole('button', { name: 'WS01', exact: true }).click();
  await expect(workbench.status).toContainText('Showing 402 of 2,005 rows');
});

test('timeline bars filter the time range', async ({ workbench, page }) => {
  await workbench.headerMenu('timestamp');
  await page.getByRole('menuitem', { name: 'Show timeline' }).click();
  const timeline = page.getByRole('region', { name: 'Timeline of timestamp' });
  await expect(timeline).toContainText('2,005 dated rows');

  await timeline.getByRole('button', { name: /: [1-9][\d,]* rows$/ }).first().click();
  await expect(workbench.status).toContainText('filtered');
  await expect(workbench.status).not.toContainText('Showing 2,005 of');
});

test('column profile reports invalid values', async ({ workbench, page }) => {
  await workbench.headerMenu('size');
  await page.getByRole('menuitem', { name: 'Profile column…' }).click();
  const dialog = page.getByRole('dialog', { name: /Profile/ });
  await expect(dialog).toContainText('Rows in view');
  await expect(dialog).toContainText(/Not a valid number\s*1/);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});
