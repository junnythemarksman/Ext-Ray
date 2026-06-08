/// <reference types="chrome" />
import { test as base, chromium, expect, type BrowserContext, type Worker } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DIST = path.join(ROOT, 'dist');
const FIX = path.join(HERE, 'fixtures', 'extensions');

// dist/ + the three fixtures, comma-joined for --load-extension / --disable-extensions-except.
const EXT_PATHS = [
  DIST,
  path.join(FIX, 'critical-ext'),
  path.join(FIX, 'high-ext'),
  path.join(FIX, 'low-ext'),
].join(',');

// MV3 service workers suspend after ~30s and Playwright doesn't always attach immediately
// (spec §9). Poll serviceWorkers() with a waitForEvent fallback instead of the naive one-shot.
// Filter to Ext-Ray's own SW (URL contains /background/) so a future fixture-extension SW can't
// be mistaken for it.
export async function getServiceWorker(context: BrowserContext): Promise<Worker> {
  const isExtRay = (w: Worker): boolean => w.url().includes('/background/');
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const sw = context.serviceWorkers().find(isExtRay);
    if (sw) return sw;
    try {
      const w = await context.waitForEvent('serviceworker', { timeout: 1_000 });
      if (isExtRay(w)) return w;
    } catch {
      /* not up yet — re-poll */
    }
  }
  throw new Error('Ext-Ray service worker did not attach within 10s');
}

// Re-acquire the worker each call so a suspension between calls doesn't use a stale handle.
export async function swEval<R>(
  context: BrowserContext,
  fn: (arg: any) => R | Promise<R>,
  arg?: any,
): Promise<R> {
  const sw = await getServiceWorker(context);
  return sw.evaluate(fn, arg) as Promise<R>;
}

type Fixtures = {
  context: BrowserContext;
  extensionId: string;
  errors: string[];
};

export const test = base.extend<Fixtures>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: !process.env.HEADED,
      args: [
        `--disable-extensions-except=${EXT_PATHS}`,
        `--load-extension=${EXT_PATHS}`,
      ],
    });
    await use(context);
    await context.close();
  },

  // auto:true → the error gate runs for every test even when not referenced explicitly.
  errors: [
    async ({ context }, use) => {
      const errors: string[] = [];
      const attach = (page: import('@playwright/test').Page) => {
        page.on('console', (m) => {
          if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
        });
        page.on('pageerror', (e) => errors.push(`pageerror: ${String(e)}`));
      };
      context.pages().forEach(attach);
      context.on('page', attach);
      await use(errors);
      expect(errors, 'no console.error / pageerror on any page').toEqual([]);
    },
    { auto: true },
  ],

  extensionId: async ({ context }, use) => {
    const sw = await getServiceWorker(context);
    await use(sw.url().split('/')[2]!);
  },
});

export { expect };
