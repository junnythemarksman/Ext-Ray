import { test, expect, swEval } from './fixtures';

const popupUrl = (id: string) => `chrome-extension://${id}/popup/index.html`;

test('renders grade F, two risky cards and one low row', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(popupUrl(extensionId));

  await expect(page.locator('.grade')).toHaveText('F');
  await expect(page.locator('.grade')).toHaveClass(/grade-f/);
  await expect(page.locator('.summary')).toHaveText('2 need a look · 1 low-risk');

  // Critical card: tier label, name, version, and the "all websites" reason.
  const critical = page.locator('article.card.tier-critical');
  await expect(critical).toHaveCount(1);
  await expect(critical.locator('.tier-label')).toHaveText('Critical');
  await expect(critical.locator('.name')).toHaveText('Fixture Critical');
  await expect(critical.locator('.version')).toHaveText('v1.0.0');
  await expect(critical.locator('.reason').first()).toContainText('all websites');

  // High card.
  const high = page.locator('article.card.tier-high');
  await expect(high).toHaveCount(1);
  await expect(high.locator('.name')).toHaveText('Fixture High');

  // Low fixture is a compact row, not a card.
  await expect(page.locator('.low-section .row')).toHaveCount(1);
  await expect(page.locator('.low-section .row .name')).toHaveText('Fixture Low');

  // Honest-limits footer present. (Apostrophe-free substring — the source uses a curly '.)
  await expect(page.locator('footer.limits')).toContainText('flags what an extension can do');
  await page.close();
});

test('fills the browser permission warning on the critical card', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(popupUrl(extensionId));
  const warning = page.locator('article.card.tier-critical .js-warning');
  // fillWarnings() is async; poll until Chrome's warning text lands.
  await expect(warning).not.toBeEmpty();
  await page.close();
});

test('Disable button actually disables the fixture', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(popupUrl(extensionId));

  const critical = page.locator('article.card.tier-critical');
  const id = await critical.getAttribute('data-ext');
  expect(id).toBeTruthy();

  await critical.locator('button[data-action="disable"]').click();
  await expect(critical).toHaveAttribute('data-enabled', 'false');

  await expect
    .poll(() => swEval<boolean>(context, async (extId) => {
      const info = await chrome.management.get(extId);
      return info.enabled;
    }, id))
    .toBe(false);
  await page.close();
});

test('Remove button calls management.uninstall with the right id (page-side spy)', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(popupUrl(extensionId));

  const critical = page.locator('article.card.tier-critical');
  const id = await critical.getAttribute('data-ext');

  // The native uninstall confirm dialog can't be driven by Playwright (spec §7); replace
  // chrome.management.uninstall in the popup PAGE context with a recorder that resolves.
  await page.evaluate(() => {
    (window as any).__uninstalls = [];
    (chrome.management as any).uninstall = (extId: string) => {
      (window as any).__uninstalls.push(extId);
      return Promise.resolve();
    };
  });

  await critical.locator('button[data-action="remove"]').click();
  await expect(critical).toHaveCount(0); // the controller removes the item on resolve
  const calls = await page.evaluate(() => (window as any).__uninstalls as string[]);
  expect(calls).toEqual([id]);
  await page.close();
});

test('an already-disabled extension renders dimmed (.is-disabled) on load', async ({ context, extensionId }) => {
  // Disable Fixture Critical first; it stays a critical-tier card (score 1.0 * 0.85 disabled-factor = 0.85).
  const id = await swEval(context, async () => {
    const all = await chrome.management.getAll();
    return all.find((e) => e.name === 'Fixture Critical').id;
  });
  await swEval(context, async (extId) => { await chrome.management.setEnabled(extId, false); }, id);

  const page = await context.newPage();
  await page.goto(popupUrl(extensionId));
  await expect(page.locator(`article.card[data-ext="${id}"]`)).toHaveClass(/is-disabled/);
  await page.close();
});

test('grade word label reads At Risk for the F fleet', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(popupUrl(extensionId));
  await expect(page.locator('.grade-word')).toHaveText('At Risk');
  await page.close();
});

test('cards and rows render extension icons (fallback for iconless fixtures)', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(popupUrl(extensionId));
  // 2 risky cards + 1 low row = 3 icon imgs; fixtures declare no icons -> bundled fallback.
  await expect(page.locator('img.ext-icon')).toHaveCount(3);
  const srcs = await page.locator('img.ext-icon').evaluateAll((els) => els.map((e) => e.getAttribute('src')));
  for (const src of srcs) expect(src).toContain('ext-fallback.svg');
  await page.close();
});
