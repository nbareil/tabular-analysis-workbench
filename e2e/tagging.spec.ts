import { expect, test, trickyCsv } from './fixtures';

test('labels rows, undoes, and keeps labels after a reload', async ({ workbench, page }) => {
  const csv = trickyCsv(50);
  await workbench.open(csv);

  await workbench.cell(0, '__tag').click({ button: 'right' });
  await page.getByRole('menu', { name: 'Cell actions' }).getByRole('menuitem', { name: 'Execution' }).click();
  await expect(workbench.cell(0, '__tag')).toHaveText('Execution');

  await page.locator('h1').click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(workbench.cell(0, '__tag')).toHaveText('Add label');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(workbench.cell(0, '__tag')).toHaveText('Execution');

  // Saves land 300 ms after an edit; a reload right after that must keep the label.
  await page.waitForTimeout(1_000);
  await page.reload();
  await workbench.reopen();
  await expect(workbench.cell(0, '__tag')).toHaveText('Execution');
});

test('edits a markdown note in the side panel', async ({ workbench, page }) => {
  await workbench.open(trickyCsv(10));
  await workbench.cell(1, '__tag').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Edit note…' }).click();

  const panel = page.getByRole('dialog', { name: 'Row labels and note' });
  await panel.getByRole('textbox', { name: 'Markdown note editor' }).fill('Suspicious **USB** device');
  await expect(panel.locator('strong')).toHaveText('USB'); // live preview
  await panel.getByRole('button', { name: 'Save changes' }).click();
  await expect(panel).toHaveCount(0);
  await expect(workbench.cell(1, '__tag')).toContainText('Note');
});
