// Drives the running dev server in headless Chromium. See SKILL.md next to this file.
//
//   NODE_PATH=/tmp/twb-driver/node_modules node .claude/skills/run-tabular-analysis-workbench/driver.cjs [smoke|open] [--csv FILE] [--light]
//
// smoke (default): load a CSV, then sort, search, filter, label + undo/redo, timeline, profile, export.
// open:            load a CSV and screenshot it, nothing else.
// Exit code 1 if any step fails or the page logs a console error.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = process.env.TWB_URL ?? 'http://localhost:5199/tabular-analysis-workbench/';
const OUT = process.env.TWB_OUT ?? '/tmp/twb-shots';
const args = process.argv.slice(2);
const mode = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--csv') ?? 'smoke';
const csvArg = args.includes('--csv') ? args[args.indexOf('--csv') + 1] : null;
const colorScheme = args.includes('--light') ? 'light' : 'dark';

// Edge cases the parser and grid must survive: duplicate header, offset/naive/µs timestamps,
// stray quote, quoted newline, blank line, extra field, short row, formula, leading zeros.
const fixtureCsv = () => {
  const lines = [
    'timestamp,host,event,user,user,size,id',
    '2024-01-01 10:00:00,WS01,"Logon, interactive",alice,dup1,100,007',
    '2024-01-01T09:30:00+02:00,WS02,12" disk inserted,bob,dup2,-5,008',
    '',
    '2024-01-01 10:05:00.123456,WS01,"multi\nline note",carol,dup3,=cmd|calc,009',
    '2024-01-02 00:00:00,WS03,Event 4624,dave,dup4,250,010,EXTRA',
    '2024-01-01 10:05:00.123,WS02,short row'
  ];
  for (let i = 0; i < 2000; i += 1) {
    const minute = String(i % 60).padStart(2, '0');
    const hour = String(Math.floor(i / 60) % 24).padStart(2, '0');
    lines.push(`2024-01-03 ${hour}:${minute}:00,WS0${i % 5},bulk event ${i},user${i % 7},x,${i},${String(i).padStart(4, '0')}`);
  }
  return lines.join('\n') + '\n';
};

const failures = [];
const log = (...a) => console.log('»', ...a);
const step = async (name, fn) => {
  try {
    await fn();
  } catch (error) {
    failures.push(name);
    log(`STEP FAILED [${name}]:`, error.message.split('\n')[0]);
  }
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 900 }, colorScheme })).newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('response', (r) => r.status() >= 400 && errors.push(`HTTP ${r.status()} ${r.url()}`));

  // Native file pickers can't be used headlessly: hand the app real OPFS file handles instead.
  await page.addInitScript(() => {
    window.showOpenFilePicker = async () => [await (await navigator.storage.getDirectory()).getFileHandle('fixture.csv')];
    window.showSaveFilePicker = async (options) =>
      (await navigator.storage.getDirectory()).getFileHandle(`saved-${options.suggestedName}`, { create: true });
  });

  await page.goto(URL);
  const csv = csvArg ? fs.readFileSync(csvArg, 'utf8') : fixtureCsv();
  await page.evaluate(async (text) => {
    const handle = await (await navigator.storage.getDirectory()).getFileHandle('fixture.csv', { create: true });
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
  }, csv);

  const status = async () => (await page.locator('footer').last().innerText()).trim().replace(/\n/g, ' ¦ ');
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });

  await page.getByRole('button', { name: 'Open Files' }).click();
  await page.getByText(/Showing [\d,]+ of [\d,]+ rows/).waitFor({ timeout: 20000 });
  await page.waitForTimeout(800); // column auto-width pass
  log('status after load:', await status());
  log('headers:', (await page.locator('.ag-header-cell').allInnerTexts()).map((h) => h.replace(/\s*☰\s*/, '').trim()).join(' | '));
  await shot('1-loaded');

  if (mode === 'smoke') {
    // Rows have no pinned/centre split: select by row-index + col-id. Headers are a custom
    // component: the first <button> sorts, the "Open X menu" button (or right-click) opens the menu.
    const cell = (row, col) => page.locator(`.ag-row[row-index="${row}"] [col-id="${col}"]`).first();

    await step('sort', async () => {
      await page.locator('.ag-header-cell[col-id="timestamp"] button').first().click();
      await page.waitForTimeout(800);
      log('first timestamp after asc sort:', await cell(0, 'timestamp').innerText());
      await shot('2-sorted');
    });

    await step('search', async () => {
      await page.getByLabel(/Search/).first().fill('disk');
      await page.waitForTimeout(1000);
      log('status after search "disk":', await status());
      log('highlight marks:', await page.locator('mark').allInnerTexts());
      await shot('3-search');
      await page.getByLabel(/Search/).first().fill('');
      await page.waitForTimeout(800);
    });

    await step('value filter', async () => {
      await page.locator('.ag-header-cell[col-id="host"]').click({ button: 'right' });
      await page.getByRole('menuitemcheckbox').first().waitFor({ timeout: 5000 });
      await shot('4-header-menu');
      await page.getByRole('menuitemcheckbox').first().click();
      await page.waitForTimeout(1000);
      log('status after value filter:', await status());
      await page.keyboard.press('Escape');
    });

    await step('label + undo/redo', async () => {
      await cell(0, '__tag').click({ button: 'right' });
      const items = page.getByRole('menu', { name: 'Cell actions' }).getByRole('group', { name: 'Labels' }).getByRole('menuitem');
      await items.first().click();
      await page.waitForTimeout(500);
      log('label applied ->', await cell(0, '__tag').innerText());
      await page.locator('h1').first().click(); // shortcuts are ignored while focus is in the grid's inputs
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(500);
      log('after undo ->', await cell(0, '__tag').innerText());
      await page.keyboard.press('Control+Shift+z');
      await page.waitForTimeout(500);
      log('after redo ->', await cell(0, '__tag').innerText());
    });

    await step('timeline', async () => {
      await page.locator('.ag-header-cell[col-id="timestamp"]').click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Show timeline' }).click();
      await page.getByText(/dated rows/).waitFor({ timeout: 5000 });
      log('timeline caption:', await page.locator('section[aria-label^="Timeline"] [aria-live]').innerText());
      await shot('5-timeline');
    });

    await step('profile', async () => {
      await page.locator('.ag-header-cell[col-id="size"]').click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Profile column…' }).click();
      await page.waitForTimeout(1000);
      await shot('6-profile');
      log('profile:', (await page.getByRole('dialog').last().innerText()).replace(/\n/g, ' ¦ ').slice(0, 300));
      await page.keyboard.press('Escape');
    });

    await step('export', async () => {
      await page.getByRole('button', { name: /Export/ }).click();
      await page.getByRole('menuitem', { name: /csv/i }).first().click();
      await page.waitForTimeout(1500);
      const exported = await page.evaluate(async () => {
        const root = await navigator.storage.getDirectory();
        for await (const [name, handle] of root.entries()) {
          if (name.startsWith('saved-')) return { name, text: await (await handle.getFile()).text() };
        }
        return null;
      });
      if (!exported) throw new Error('no exported file written to OPFS');
      fs.writeFileSync(path.join(OUT, 'export.csv'), exported.text);
      log('export:', exported.name, '->', path.join(OUT, 'export.csv'));
      log('export head:\n' + exported.text.split('\n').slice(0, 4).join('\n'));
    });
  }

  log('console errors:', errors.length ? errors : 'none');
  log('screenshots in', OUT);
  await browser.close();
  process.exit(failures.length || errors.length ? 1 : 0);
})().catch((error) => {
  console.error('DRIVER FAILED', error);
  process.exit(1);
});
