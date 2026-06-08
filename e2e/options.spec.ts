import { test, expect, swEval } from './fixtures';

const optionsUrl = (id: string) => `chrome-extension://${id}/options/index.html`;
const ALARM = 'extray-scan';

const getSettings = (context: import('@playwright/test').BrowserContext) =>
  swEval<{ monitoringEnabled: boolean; scanIntervalMinutes: number; notify: boolean }>(
    context,
    async () => {
      const got = await chrome.storage.local.get('settings');
      return got.settings;
    },
  );

test('monitoring toggle persists and reconciles the alarm', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(optionsUrl(extensionId));

  // Default is on → an alarm exists.
  await expect
    .poll(() => swEval<number | null>(context, async (name) => {
      const a = await chrome.alarms.get(name);
      return a ? a.periodInMinutes ?? null : null;
    }, ALARM))
    .not.toBeNull();

  // Turn monitoring OFF → setting persists and the alarm is cleared.
  await page.locator('input[data-setting="monitoring"]').uncheck();
  await expect.poll(async () => (await getSettings(context)).monitoringEnabled).toBe(false);
  await expect
    .poll(() => swEval<boolean>(context, async (name) => !(await chrome.alarms.get(name)), ALARM))
    .toBe(true);
  await page.close();
});

test('cadence change recreates the alarm with the new period', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(optionsUrl(extensionId));

  await page.locator('select[data-setting="cadence"]').selectOption('15');
  await expect.poll(async () => (await getSettings(context)).scanIntervalMinutes).toBe(15);
  await expect
    .poll(() => swEval<number | null>(context, async (name) => {
      const a = await chrome.alarms.get(name);
      return a ? a.periodInMinutes ?? null : null;
    }, ALARM))
    .toBe(15);
  await page.close();
});

test('notify toggle and ignore toggle persist', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(optionsUrl(extensionId));

  await page.locator('input[data-setting="notify"]').uncheck();
  await expect.poll(async () => (await getSettings(context)).notify).toBe(false);

  // Ignore the first listed extension.
  const firstIgnore = page.locator('input[data-ignore]').first();
  const ignoredId = await firstIgnore.getAttribute('data-ignore');
  await firstIgnore.check();
  await expect
    .poll(() => swEval<string[]>(context, async () => (await chrome.storage.local.get('ignored')).ignored ?? []))
    .toContain(ignoredId);
  await page.close();
});

test('(e) options layout has no horizontal overflow at 420px', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 420, height: 700 });
  await page.goto(optionsUrl(extensionId));
  await expect(page.locator('.options')).toBeVisible();

  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
  await expect(page.locator('select[data-setting="cadence"]')).toBeVisible();
  await page.close();
});
