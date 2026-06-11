// Store-screenshot generator (Phase 9 §3.4). Captures the REAL UI over a varied fixture
// fleet so CWS screenshots match actual behavior by construction: each page is captured
// FULL-PAGE at its natural width (nothing below the fold is hidden — honest-limits footer,
// donation section, all of it), then composed centered on a 1280x800 stage. Content is the
// untouched capture; only the framing canvas is added. deviceScaleFactor 2 keeps text crisp.
// Run: npm run shots   (builds dist/ first via the npm script)
import { chromium } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const E2E_FIX = path.join(ROOT, 'e2e', 'fixtures', 'extensions');
const OUT = path.join(ROOT, 'shots');
mkdirSync(OUT, { recursive: true });

// The three e2e fixtures cover critical/high/low; add one medium (clipboardWrite 0.3
// + dev-install 0.15 = 0.45 -> medium) in a temp dir for a fuller-looking report.
const mediumDir = path.join(mkdtempSync(path.join(tmpdir(), 'extray-shot-')), 'medium-ext');
mkdirSync(mediumDir, { recursive: true });
writeFileSync(path.join(mediumDir, 'manifest.json'), JSON.stringify({
  manifest_version: 3, name: 'Quick Copy', version: '1.0.0',
  description: 'Screenshot fixture: clipboardWrite (medium tier).',
  permissions: ['clipboardWrite'],
}, null, 2));

const EXT_PATHS = [
  DIST,
  path.join(E2E_FIX, 'critical-ext'),
  path.join(E2E_FIX, 'high-ext'),
  path.join(E2E_FIX, 'low-ext'),
  mediumDir,
].join(',');

const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: true,
  viewport: { width: 640, height: 400 },
  deviceScaleFactor: 2,
  args: [`--disable-extensions-except=${EXT_PATHS}`, `--load-extension=${EXT_PATHS}`],
});

async function sw() {
  for (let i = 0; i < 20; i++) {
    const w = context.serviceWorkers().find((x) => x.url().includes('/background/'));
    if (w) return w;
    try { return await context.waitForEvent('serviceworker', { timeout: 1000 }); } catch { /* retry */ }
  }
  throw new Error('service worker did not attach');
}
const worker = await sw();
const extId = worker.url().split('/')[2];

// Capture the page full-height at its natural content width, then place the untouched
// capture centered on a 1280x800 dark stage (stage viewport 640x400 @ dsf2 = 1280x800 px).
async function shoot(rel, file, ready, contentWidth) {
  const page = await context.newPage();
  await page.setViewportSize({ width: contentWidth, height: 640 });
  await page.goto(`chrome-extension://${extId}/${rel}`);
  await page.waitForSelector(ready);
  await page.waitForTimeout(600); // async fills (permission warnings) settle
  const raw = await page.screenshot({ fullPage: true });
  await page.close();

  const stage = await context.newPage();
  await stage.setViewportSize({ width: 640, height: 400 });
  await stage.setContent(`<!doctype html><style>
    body { margin: 0; width: 640px; height: 400px; display: grid; place-items: center;
      background: radial-gradient(520px 360px at 50% 42%, #1b2740, #0b1220); }
    img { max-width: 600px; max-height: 376px; border-radius: 8px;
      box-shadow: 0 10px 40px rgba(0,0,0,.55); }
  </style><img src="data:image/png;base64,${raw.toString('base64')}">`);
  await stage.waitForFunction(() => {
    const i = document.querySelector('img');
    return i && i.complete && i.naturalWidth > 0;
  });
  await stage.screenshot({ path: path.join(OUT, file) });
  await stage.close();
}

await shoot('popup/index.html', 'popup-1280x800.png', '.report, .error', 360);
await shoot('options/index.html', 'options-1280x800.png', '.options', 420);
await shoot('onboarding/index.html', 'onboarding-1280x800.png', '.onboard', 820);

await context.close();
console.log(`shots written to ${OUT}: popup-1280x800.png, options-1280x800.png, onboarding-1280x800.png`);
