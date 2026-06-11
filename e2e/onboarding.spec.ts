import { test, expect } from './fixtures';

// Launching the persistent context IS a fresh install, so onInstalled(reason='install')
// fires and the SW must open the onboarding tab exactly once. The auto error-gate in
// fixtures.ts also watches this tab — it must be console-error-free.
test('onboarding tab auto-opens on install and renders the reassurances', async ({ context }) => {
  let page;
  await expect
    .poll(() => {
      page = context.pages().find((p) => p.url().includes('/onboarding/index.html'));
      return Boolean(page);
    }, { timeout: 10_000 })
    .toBe(true);

  await expect(page.locator('h1')).toHaveText('Ext-Ray is ready');
  await expect(page.locator('.point')).toHaveCount(3);
  await expect(page.locator('.point h2').nth(0)).toHaveText('Read-only by default');
  await expect(page.locator('.point h2').nth(1)).toHaveText('100% on-device');
  await expect(page.locator('.foot a')).toHaveAttribute(
    'href', 'https://junnythemarksman.github.io/ext-ray-privacy/');

  // Got it → the tab closes itself (window.close works: the SW opened this tab).
  await page.locator('#done').click();
  await expect
    .poll(() => context.pages().some((p) => p.url().includes('/onboarding/')))
    .toBe(false);
});
