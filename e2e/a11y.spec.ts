import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

import { expect, test, trickyCsv } from './fixtures';

const audit = async (page: Page) => {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return violations.map((violation) => ({
    rule: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.slice(0, 3).map((node) => node.target.join(' '))
  }));
};

for (const theme of ['dark', 'light'] as const) {
  test.describe(`${theme} theme`, () => {
    test.use({ colorScheme: theme });

    test('empty start screen has no axe violations', async ({ workbench, page }) => {
      void workbench;
      expect(await audit(page)).toEqual([]);
    });

    test('loaded grid, filter and menus have no axe violations', async ({ workbench, page }) => {
      await workbench.open(trickyCsv(50));
      await workbench.showFilters();
      await page.getByRole('button', { name: 'Add Filter' }).click();
      expect(await audit(page)).toEqual([]);

      await workbench.headerMenu('host');
      await expect(page.getByRole('menuitemcheckbox').first()).toBeVisible();
      expect(await audit(page)).toEqual([]);
      await page.keyboard.press('Escape');

      await workbench.headerMenu('timestamp');
      await page.getByRole('menuitem', { name: 'Show timeline' }).click();
      await expect(page.getByRole('region', { name: 'Timeline of timestamp' })).toContainText('dated rows');
      expect(await audit(page)).toEqual([]);
    });

    for (const dialog of ['Options', 'Columns', 'Labels'] as const) {
      test(`${dialog} dialog has no axe violations`, async ({ workbench, page }) => {
        await workbench.open(trickyCsv(10));
        await page.getByRole('button', { name: dialog, exact: true }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        expect(await audit(page)).toEqual([]);
      });
    }
  });
}

test('core flow works from the keyboard', async ({ workbench, page }) => {
  await workbench.open(trickyCsv(10));
  await page.keyboard.press('/');
  await expect(page.getByLabel('Search visible columns')).toBeFocused();
  await page.keyboard.type('disk');
  await expect(workbench.status).toContainText('Showing 1 of');
  await page.keyboard.press('Escape');

  await workbench.headerMenu('host');
  await expect(page.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
});
