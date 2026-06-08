import { test, expect, swEval } from './fixtures';

test('service worker attaches and resolves an extension id', async ({ context, extensionId }) => {
  expect(extensionId).toMatch(/^[a-p]{32}$/); // Chrome extension ids are 32 chars a–p
});

test('popup page opens with no console errors', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup/index.html`);
  await expect(page.locator('.report, .error')).toBeVisible();
  await page.close();
  // the auto `errors` fixture asserts an empty error list at teardown
});

test('the three fixtures are visible to chrome.management', async ({ context }) => {
  const names = await swEval<string[]>(context, async () => {
    const all = await chrome.management.getAll();
    return all.filter((e) => e.type === 'extension').map((e) => e.name);
  });
  expect(names).toEqual(expect.arrayContaining(['Fixture Critical', 'Fixture High', 'Fixture Low']));
});
