# Phase 9 — Store-Listing Readiness Implementation Plan

> Implement task-by-task; steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Ext-Ray Chrome-Web-Store submission-ready: a first-run onboarding page (code), a store-screenshot generator, and the `docs/store/` submission documents — leaving only owner-external steps in a checklist.

**Architecture:** One static onboarding page + a tiny close-button module, wired by a 3-line `onInstalled` change in the service worker (no new permission — the check-dist 4-permission guard must keep passing). Screenshots come from the proven Playwright persistent-context harness. Everything else is documents.

**Tech Stack:** Vanilla TS/HTML/CSS, the existing two-pass Vite build, `@playwright/test` (already installed).

**Spec:** [docs/dev/specs/2026-06-11-phase9-store-readiness-design.md](../specs/2026-06-11-phase9-store-readiness-design.md)


---

## File Structure

| File | Responsibility |
|---|---|
| `onboarding/index.html` (create) | Static first-run page: read-only / on-device / why-management + privacy link + Got-it. |
| `onboarding/onboarding.css` (create) | Page styling, reusing the popup's dark-theme variables. |
| `onboarding/index.ts` (create) | One listener: Got-it → `window.close()` (MV3 CSP forbids inline scripts). |
| `src/background/index.ts` (modify) | `onInstalled(reason==='install')` → open the onboarding tab (guarded). |
| `vite.config.ts` (modify) | Add onboarding to the pages-pass input. |
| `tsconfig.json` (modify) | Add `"onboarding"` to include. |
| `scripts/check-dist.mjs` (modify) | Assert `dist/onboarding/index.html` exists. |
| `e2e/onboarding.spec.ts` (create) | Install → tab auto-opens, renders, error-free; Got-it closes it. |
| `scripts/shots.mjs` (create) + `package.json` + `.gitignore` (modify) | `npm run shots` → 1280×800 store screenshots into `shots/` (gitignored). |
| `docs/store/listing.md` (create) | Description, single-purpose, per-permission justifications, dashboard answers, screenshot plan. |
| `docs/store/trademark.md` (create) | EXT-RAY clearance verdict + recommended next step (not legal advice). |
| `docs/store/submission-checklist.md` (create) | Ordered owner-only external steps with sources. |
| `docs/ROADMAP.md` + `README.md` (modify, last) | Phase 9 → ✅, Phase 10 → next; README onboarding/privacy notes. |

---

## Task 1: Onboarding page + build wiring

**Files:**
- Create: `onboarding/index.html`, `onboarding/onboarding.css`, `onboarding/index.ts`
- Modify: `vite.config.ts:30`, `tsconfig.json:16`, `scripts/check-dist.mjs` (after the referenced-files loop)

- [ ] **Step 1: Create `onboarding/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Welcome to Ext-Ray</title>
    <link rel="stylesheet" href="./onboarding.css" />
  </head>
  <body>
    <main class="onboard">
      <header class="hero">
        <img src="../icons/icon-48.png" alt="" width="48" height="48" />
        <h1>Ext-Ray is ready</h1>
        <p class="tagline">Audit the security of your other extensions — entirely on your own device.</p>
      </header>

      <section class="points">
        <article class="point">
          <h2>Read-only by default</h2>
          <p>Ext-Ray never disables or removes another extension on its own. Nothing changes
          unless you click a button.</p>
        </article>
        <article class="point">
          <h2>100% on-device</h2>
          <p>No servers, no accounts, no analytics. Ext-Ray makes zero network requests —
          nothing you do ever leaves your browser.</p>
        </article>
        <article class="point">
          <h2>About the permission warning</h2>
          <p>Chrome warned that Ext-Ray can “manage your apps, extensions, and themes.”
          That permission is what lets Ext-Ray <em>read</em> your extension list and Chrome’s own
          warning text to score risk. Ext-Ray only acts on another extension when you ask it to.</p>
        </article>
      </section>

      <section class="next">
        <h2>What happens now</h2>
        <p>Click the Ext-Ray icon in your toolbar for your first audit. In the background,
        Ext-Ray re-scans periodically and notifies you if an extension changes in a suspicious
        way. Tune this in the options page.</p>
      </section>

      <footer class="foot">
        <a href="https://junnythemarksman.github.io/ext-ray-privacy/" target="_blank" rel="noreferrer">Privacy policy</a>
        <button id="done" class="btn">Got it</button>
      </footer>
    </main>
    <script type="module" src="./index.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: Create `onboarding/onboarding.css`**

```css
:root {
  --bg: #0f172a; --panel: #1e293b; --text: #e2e8f0; --muted: #94a3b8;
  color-scheme: dark;
}
* { box-sizing: border-box; }
body { margin: 0; font: 15px/1.6 system-ui, sans-serif; background: var(--bg); color: var(--text); }
.onboard { max-width: 720px; margin: 0 auto; padding: 48px 24px; }
.hero { text-align: center; margin-bottom: 32px; }
.hero h1 { margin: 12px 0 4px; font-size: 26px; }
.tagline { color: var(--muted); margin: 0; }
.points { display: grid; gap: 12px; }
.point { background: var(--panel); border-radius: 10px; padding: 16px 18px; }
.point h2 { margin: 0 0 6px; font-size: 15px; }
.point p { margin: 0; color: var(--muted); }
.next { margin-top: 24px; }
.next h2 { font-size: 15px; margin: 0 0 6px; }
.next p { margin: 0; color: var(--muted); }
.foot { margin-top: 32px; display: flex; align-items: center; justify-content: space-between; }
.foot a { color: var(--muted); }
.btn { font: inherit; padding: 8px 22px; border-radius: 8px; border: 1px solid #334155;
  background: #334155; color: var(--text); cursor: pointer; }
```

- [ ] **Step 3: Create `onboarding/index.ts`**

```ts
// onboarding/ — first-run page (design spec Phase 9 §3.1). Static content; this module
// exists only because MV3 extension-page CSP forbids inline handlers. window.close()
// works without any chrome.* API because the service worker opened this tab.
document.getElementById('done')?.addEventListener('click', () => window.close());
```

- [ ] **Step 4: Add onboarding to the pages-pass input in `vite.config.ts`**

Change line 30 from:
```ts
          input: { popup: 'popup/index.html', options: 'options/index.html' },
```
to:
```ts
          input: { popup: 'popup/index.html', options: 'options/index.html', onboarding: 'onboarding/index.html' },
```

- [ ] **Step 5: Add `"onboarding"` to `tsconfig.json` include**

Change `"include": ["src", "popup", "options"]` to `"include": ["src", "popup", "options", "onboarding"]`.

- [ ] **Step 6: Assert the page ships, in `scripts/check-dist.mjs`**

Insert immediately AFTER the `for (const rel of referenced) {...}` loop (after its closing `}`):
```js
// Phase 9: the onboarding page is opened by the SW (not referenced by the manifest).
existsSync(resolve(dist, 'onboarding/index.html'))
  ? ok('exists: onboarding/index.html')
  : fail('onboarding/index.html missing from dist');
```

- [ ] **Step 7: Verify build + checks**

Run: `npm run typecheck && npm run verify:build && npm test`
Expected: tsc clean; check-dist prints `✓ exists: onboarding/index.html` and `check-dist: OK`; 86 unit tests pass.

- [ ] **Step 8: Commit**

```bash
git add onboarding vite.config.ts tsconfig.json scripts/check-dist.mjs
git commit -m "feat(onboarding): first-run page (read-only / on-device / why management)"
```

---

## Task 2: Open onboarding once on install + E2E spec

**Files:**
- Modify: `src/background/index.ts:75` (the `onInstalled` listener)
- Create: `e2e/onboarding.spec.ts`

- [ ] **Step 1: Wire the install-only tab open**

In `src/background/index.ts`, replace:
```ts
chrome.runtime.onInstalled.addListener(() => void init());
```
with:
```ts
chrome.runtime.onInstalled.addListener((details) => {
  void init();
  // First-run onboarding (Phase 9): once per INSTALL only — never on update/reload.
  // tabs.create needs no permission; a failure must never break init.
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding/index.html') })
      .catch((e) => { if (tSec.enabled) tSec('onboarding open failed', { error: String(e) }); });
  }
});
```

- [ ] **Step 2: Write `e2e/onboarding.spec.ts`**

```ts
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
```

- [ ] **Step 3: Build + run the new spec, then the whole e2e suite**

Run: `npm run typecheck && npm run build && npx playwright test e2e/onboarding.spec.ts`
Expected: 1 passed.
Then: `npx playwright test`
Expected: **14 passed** (the 13 existing + this one). The auto-opened tab must not break any
existing spec; if one fails, READ the failure — do not edit other specs to force green; report BLOCKED.

- [ ] **Step 4: Commit**

```bash
git add src/background/index.ts e2e/onboarding.spec.ts
git commit -m "feat(guardian): open onboarding once on install + e2e spec"
```

---

## Task 3: Store-screenshot generator (`npm run shots`)

**Files:**
- Create: `scripts/shots.mjs`
- Modify: `package.json` (script), `.gitignore` (+`shots/`)

- [ ] **Step 1: Create `scripts/shots.mjs`**

```js
// Store-screenshot generator (Phase 9 §3.4). Captures the REAL UI over a varied fixture
// fleet so CWS screenshots match actual behavior by construction. Output: shots/*.png at
// 1280x800 (640x400 viewport @ deviceScaleFactor 2 — same pixels, sharper text).
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

async function shoot(rel, file, ready) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extId}/${rel}`);
  await page.waitForSelector(ready);
  await page.waitForTimeout(600); // async fills (permission warnings) settle
  await page.screenshot({ path: path.join(OUT, file) });
  await page.close();
}

await shoot('popup/index.html', 'popup-1280x800.png', '.report, .error');
await shoot('options/index.html', 'options-1280x800.png', '.options');
await shoot('onboarding/index.html', 'onboarding-1280x800.png', '.onboard');

await context.close();
console.log(`shots written to ${OUT}: popup-1280x800.png, options-1280x800.png, onboarding-1280x800.png`);
```

- [ ] **Step 2: Add the npm script and gitignore entry**

`package.json` scripts (keep all existing): `"shots": "npm run build && node scripts/shots.mjs"`.
Append `shots/` to `.gitignore`.

- [ ] **Step 3: Run it and inspect**

Run: `npm run shots`
Expected: prints the three written files; each PNG is 1280×800 (verify: `node -e "const b=require('fs').readFileSync('shots/popup-1280x800.png'); console.log(b.readUInt32BE(16), b.readUInt32BE(20))"` → `1280 800`).

- [ ] **Step 4: Commit**

```bash
git add scripts/shots.mjs package.json .gitignore
git commit -m "feat(store): npm run shots generates 1280x800 store screenshots from the real UI"
```

---

## Task 4: `docs/store/listing.md` + `docs/store/trademark.md`

**Files:**
- Create: `docs/store/listing.md`, `docs/store/trademark.md`

- [ ] **Step 1: Create `docs/store/listing.md`** with exactly:

````markdown
# Ext-Ray — Chrome Web Store listing (copy-paste source)

All text below is written against the 2025–26 CWS policies: accurate claims only, zero
superlatives, every claim implemented in the submitted build. Sources:
[program policies](https://developer.chrome.com/docs/webstore/program-policies/policies),
[dashboard privacy](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy) (2025).

## Name
Ext-Ray

## Short description (≤132 chars)
Audit the security of your other extensions — risk grades, plain-English reasons, and
change alerts. 100% on-device.

## Full description
Ext-Ray inspects every extension you have installed and grades its security risk — entirely
on your own device.

WHAT IT DOES
• Risk report: an A–F grade for your whole extension set, with a card per risky extension
  explaining, in plain English, what it *could* do (e.g. "Can read and change your data on
  all websites") — including Chrome's own warning text for that extension.
• Change guardian: Ext-Ray remembers a snapshot of each extension's declared permissions and
  version, re-scans in the background, and notifies you when something changes silently —
  the pattern behind the major real-world extension attacks of 2024–26, where a trusted
  extension turns malicious through a quiet update.
• One-click response: disable or remove a risky extension from the report (removal always
  goes through Chrome's own confirmation dialog).

WHAT IT DOES NOT DO
• No data collection. No servers, accounts, analytics, or telemetry. Ext-Ray makes zero
  network requests; nothing you do leaves your browser.
• No code or traffic inspection. Ext-Ray reads only the metadata extensions declare
  (permissions, version, install source). A high grade means an extension *can* do risky
  things — it is not proof of malice, and Ext-Ray says so in the report.
• Read-only by default. Ext-Ray never changes another extension without your click.

PERMISSIONS, PLAINLY
• "Manage your apps, extensions, and themes" — this is the read access that makes the audit
  possible. • Storage — your settings and the latest snapshot, kept locally. • Alarms — the
  background re-scan schedule. • Notifications — change alerts.

Privacy policy: https://junnythemarksman.github.io/ext-ray-privacy/

## Category
Tools (owner confirms in dashboard)

## Dashboard — Privacy practices tab (paste-ready)

**Single purpose:**
Audits the security and privacy risk of the user's installed Chrome extensions entirely
on-device, read-only, with no data collection or network transmission.

**Permission justifications:**
- management: Read-only enumeration of installed extensions (chrome.management.getAll) and
  Chrome's own warning text (getPermissionWarningsById) to compute risk scores on-device.
  setEnabled/uninstall are invoked only when the user explicitly clicks Disable/Remove on a
  specific extension; uninstall always shows Chrome's native confirmation dialog.
- storage: Persists user settings and the most recent extension-metadata snapshot locally
  (chrome.storage.local) so changes can be detected between scans. Nothing is transmitted.
- alarms: Schedules the periodic background re-scan chosen in the options page.
- notifications: Alerts the user when a scan detects a suspicious change (e.g. an extension
  silently gaining host access).

**Remote code:** No, I am not using remote code.
**Data types collected:** none (leave every checkbox unchecked).
**Limited Use certification:** certify — trivially satisfied; no data is collected or shared.

## Screenshots (1280×800, generated from the real UI)
Run `npm run shots` → `shots/popup-1280x800.png`, `shots/options-1280x800.png`,
`shots/onboarding-1280x800.png`. NOTE before uploading: the screenshot fleet is loaded
unpacked, so extensions carry a small "installed outside the Web Store (development)" bump
and reason line; reviewers compare screenshots to behavior, and these ARE real behavior —
but the owner should eyeball each capture (and may retake on a real fleet) before upload.
````

- [ ] **Step 2: Create `docs/store/trademark.md`** with exactly:

````markdown
# "Ext-Ray" trademark clearance summary (2026-06)

**Verdict: clear-but-provisional.** This is a research summary, **not legal advice**.

- **USPTO:** no live registration or application for EXT-RAY / EXTRAY was surfaced in the
  relevant classes (Nice 9 — software; 42 — security services) in the 2026-06 search passes.
- **"Ex-Ray" (2017):** an academic analysis tool described in a research paper — not a
  product or registered mark; one letter apart in the same niche is a soft caveat only.
- **Amazon X-Ray / Anyscale Ray:** different marks, different goods/services; no conflict
  surfaced for a browser-extension security auditor.
- **Chrome Web Store:** no name collision surfaced for "Ext-Ray".

**Recommended next step:** ship under "Ext-Ray". If the extension gains traction, consider a
USPTO Class 9 filing and a clearance opinion from a trademark attorney before scaling
distribution or accepting payment. Re-run the CWS name search immediately before submission
(listings change).
````

- [ ] **Step 3: Commit**

```bash
git add docs/store/listing.md docs/store/trademark.md
git commit -m "docs(store): listing copy + dashboard answers + trademark verdict"
```

---

## Task 5: `docs/store/submission-checklist.md` (owner-only steps)

**Files:**
- Create: `docs/store/submission-checklist.md`

- [ ] **Step 1: Create the checklist** with exactly:

````markdown
# Chrome Web Store submission checklist — owner-only steps

Everything the repo can produce is done (onboarding page, screenshots, listing copy,
privacy policy text). The steps below require the owner's accounts/identity and are listed
in execution order. Sources are 2025–26 CWS primary docs.

## One-time account setup
- [ ] Enable **2-Step Verification** on the publishing Google account — hard gate, no
      submission without it. [2SV policy](https://developer.chrome.com/docs/webstore/program-policies/two-step-verification)
- [ ] Pay the one-time **$5 developer registration fee** (if not already registered).
- [ ] Complete the **Trader / Non-Trader** declaration (EU DSA). Free, personal,
      non-monetized → Non-Trader is the likely fit; owner decides.
      [Trader disclosure](https://developer.chrome.com/docs/webstore/program-policies/trader-disclosure)

## Privacy plumbing
- [ ] **Create the `extray.support@gmail.com` address** (it does not exist yet) — it is the
      published contact on the privacy policy.
- [ ] **Enable GitHub Pages** on `ext-ray-privacy`: Settings → Pages → Deploy from branch →
      `main` / root. Verify https://junnythemarksman.github.io/ext-ray-privacy/ renders.
- [ ] Paste that URL into the dashboard's per-item **privacy policy** field.

## Dashboard fields (paste from docs/store/listing.md)
- [ ] Single-purpose statement; per-permission justifications; remote code = **No**;
      data-types = **none**; Limited-Use certification. The **Privacy Practices tab is a
      hard publishing gate** — incomplete fields block publishing and risk a 30-day warning.
      [Dashboard privacy](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)

## Package & verify
- [ ] `npm run verify:build` (enforces MV3 loadability + the exactly-4-permissions /
      no-host / module-SW trust invariant).
- [ ] **Test the exact ZIP you will upload**: zip `dist/`, load the packed ZIP in a clean
      profile, click through popup/options/onboarding. "Broken functionality" is the most
      common rejection.
- [ ] `npm run shots`; eyeball all three screenshots against the live extension before upload.

## Submission expectations
- [ ] `management` ⇒ **guaranteed manual review**; current backlog means **1–2+ weeks** —
      budget accordingly. [Review process](https://developer.chrome.com/docs/webstore/review-process)
- [ ] **One appeal per violation** (2025 rule): if rejected, fix everything first, appeal
      once, never preemptively. [2025 policy updates](https://developer.chrome.com/blog/cws-policy-updates-2025)
- [ ] **Verified CRX upload** is optional and binds an RSA key irreversibly — decide
      deliberately; losing the key strands the listing.
- [ ] Expectation: security tools are excluded from the store's "Featured" program.
````

- [ ] **Step 2: Commit**

```bash
git add docs/store/submission-checklist.md
git commit -m "docs(store): owner-only submission checklist (2025-26 CWS rules)"
```

---

## Task 6: Full verification + ROADMAP/README close-out

**Files:**
- Modify: `docs/ROADMAP.md` (Phase 9 row + "Where we are"), `README.md` (status + install note)

- [ ] **Step 1: Run everything**

Run: `npm run typecheck && npm test && npm run test:e2e`
Expected: tsc clean; 86 unit; **14 e2e** (13 + onboarding).

- [ ] **Step 2: ROADMAP** — Phase 9 row status `◀ **next**` → `✅`; Phase 10 row → `◀ **next**`;
rewrite the "Where we are" paragraph: Phase 9 shipped the onboarding page (opened once on
install, no new permission), `npm run shots`, and `docs/store/` (listing copy, trademark
verdict, owner checklist); the privacy policy is finalized in the `ext-ray-privacy` repo;
remaining external steps are owner-only (checklist). Phase 10 (on-device AI) is next; note the
queued post-Phase-9 "signal pack" from the audit/delta sections.

- [ ] **Step 3: README** — update the Status blurb: Phases 0–9 ✅, submission-ready; add one
line under the install/usage area noting the first-run onboarding page and linking the
privacy policy (https://junnythemarksman.github.io/ext-ray-privacy/).

- [ ] **Step 4: Commit**

```bash
git add docs/ROADMAP.md README.md
git commit -m "docs: mark Phase 9 complete (store readiness), Phase 10 next"
```

- [ ] **Step 5: Finish the branch** — the finish-branch checklist (final review, fast-forward merge) (final review,
fast-forward merge `phase-9-store-readiness` → `main`).

---

## Self-Review

**Spec coverage:** §3.1→Task 1; §3.2→Task 2; §3.3→Task 1 (steps 4–6); §3.4→Task 3; §3.5→Tasks 4–5;
§3.6→Task 6; §5 testing→Task 2 (spec) + Task 6 (suite); §6 error handling→Task 2 step 1 (`.catch` +
`tSec`); §7 fixture-inflation honesty→Task 4 listing.md screenshot note. ✓
**Placeholders:** none — all file contents are complete and literal. ✓
**Consistency:** `tSec` exists in `src/background/index.ts` (Task 7, Phase 8); onboarding selectors in
the e2e spec match the Task 1 HTML (`h1`, `.point`, `.foot a`, `#done`); fixture tier math verified
against `weights.ts` (clipboardWrite 0.3+0.15=0.45→medium); privacy URL identical in all three
places (HTML, listing.md, checklist). ✓
