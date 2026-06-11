# Phase 5 — MV3 Build Pipeline Implementation Plan

> Implement task-by-task; steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm run build` produces a loadable MV3 `dist/` (bundled service worker, stub popup/options, manifest, placeholder icons) so Ext-Ray installs as an unpacked extension and the guardian runs live.

**Architecture:** Hand-rolled Vite, **zero new dependencies**, two build passes into one `dist/`: a multi-input *pages* pass (stub popup/options; `publicDir` copies manifest + icons) and a separate single-input *service-worker* pass with `inlineDynamicImports` (one self-contained file, dodging the MV3 dynamic-import/preload footgun). Spec: `docs/dev/specs/2026-06-06-phase5-build-design.md`.

**Tech Stack:** Vite 6 (already installed), Node (zlib for the icon generator), TypeScript. No build plugin.

---

## File structure

| File | Responsibility |
|---|---|
| `scripts/gen-icons.mjs` (create) | Pure-Node placeholder PNG generator (zlib) |
| `public/icons/icon-{16,32,48,128}.png` (generated) | Placeholder icon set |
| `public/manifest.json` (moved from root + `icons` block) | MV3 manifest (build source; copied verbatim to `dist/`) |
| `popup/index.html` + `popup/index.ts` (create) | Stub popup page |
| `options/index.html` + `options/index.ts` (create) | Stub options page |
| `src/background/index.ts` (modify, 1 line) | `iconUrl` → `chrome.runtime.getURL(...)` |
| `vite.config.ts` (modify) | Two-pass build config (keeps the vitest `test` block) |
| `package.json` (modify) | `build`, `build:watch`, `verify:build` scripts |
| `scripts/check-dist.mjs` (create) | Post-build assertion of the loadable contract |

Note: `dist/` is already in `.gitignore`. The build is not unit-TDD-able; the gate is "build succeeds + `check-dist.mjs` passes + the 64 existing unit tests stay green" (spec §4).

---

## Task 1: Placeholder icon generator + icons

**Files:**
- Create: `scripts/gen-icons.mjs`
- Generated: `public/icons/icon-{16,32,48,128}.png`

- [ ] **Step 1: Create the generator**

Create `scripts/gen-icons.mjs`:

```js
// Generates placeholder extension icons as valid PNGs using only Node + zlib
// (no image dependency). A slate square with a sky-blue inset — clearly a
// placeholder, replaced with real branding in Phase 9. Re-run: `node scripts/gen-icons.mjs`.
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
};
const png = (size) => {
  const bg = [15, 23, 42, 255];   // slate-900
  const fg = [56, 189, 248, 255]; // sky-400
  const inset = Math.max(1, Math.floor(size / 4));
  const stride = 1 + size * 4;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const glyph = x >= inset && x < size - inset && y >= inset && y < size - inset;
      const [r, g, b, a] = glyph ? fg : bg;
      const o = y * stride + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
};

const dir = resolve('public/icons');
mkdirSync(dir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  writeFileSync(resolve(dir, `icon-${size}.png`), png(size));
  console.log(`wrote icon-${size}.png`);
}
```

- [ ] **Step 2: Generate the icons**

Run: `node scripts/gen-icons.mjs`
Expected: prints `wrote icon-16.png` … `wrote icon-128.png`; creates `public/icons/icon-{16,32,48,128}.png`.

- [ ] **Step 3: Verify they are valid PNGs**

Run: `node -e "const b=require('fs').readFileSync('public/icons/icon-128.png');console.log(b.length>0 && b[0]===0x89 && b.toString('ascii',1,4)==='PNG')"`
Expected: `true`

- [ ] **Step 4: Commit**

```bash
git add scripts/gen-icons.mjs public/icons/
git commit -m "build: add placeholder extension icons + generator"
```

---

## Task 2: Move manifest to public/ and add the icons block

**Files:**
- Move: `manifest.json` → `public/manifest.json`
- Modify: `public/manifest.json` (add `icons`)

- [ ] **Step 1: Move the manifest**

Run: `git mv manifest.json public/manifest.json`

- [ ] **Step 2: Add the icons block**

In `public/manifest.json`, add an `icons` key (after `permissions`). The full file should read:

```json
{
  "manifest_version": 3,
  "name": "Ext-Ray",
  "version": "0.0.1",
  "description": "Audit the security of your other browser extensions — entirely on your own device.",
  "minimum_chrome_version": "120",
  "permissions": ["management", "storage", "alarms", "notifications"],
  "icons": {
    "16": "icons/icon-16.png",
    "32": "icons/icon-32.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  },
  "background": {
    "service_worker": "background/index.js",
    "type": "module"
  },
  "action": {
    "default_popup": "popup/index.html",
    "default_title": "Ext-Ray"
  },
  "options_page": "options/index.html"
}
```

- [ ] **Step 3: Verify valid JSON + icon paths resolve**

Run: `node -e "const m=require('./public/manifest.json');const fs=require('fs');console.log(m.manifest_version===3 && Object.values(m.icons).every(p=>fs.existsSync('public/'+p)))"`
Expected: `true`

- [ ] **Step 4: Commit**

```bash
git add public/manifest.json
git commit -m "build: move manifest to public/ and declare icons"
```

---

## Task 3: Stub popup + options pages

**Files:**
- Create: `popup/index.html`, `popup/index.ts`
- Create: `options/index.html`, `options/index.ts`

- [ ] **Step 1: Create the popup stub**

Create `popup/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Ext-Ray</title>
  </head>
  <body>
    <main id="app">Ext-Ray</main>
    <script type="module" src="./index.ts"></script>
  </body>
</html>
```

Create `popup/index.ts`:

```ts
// Stub popup — replaced by the real report UI in Phase 6.
const app = document.querySelector('#app');
if (app) app.textContent = 'Ext-Ray — full report coming soon.';
```

- [ ] **Step 2: Create the options stub**

Create `options/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Ext-Ray Settings</title>
  </head>
  <body>
    <main id="app">Ext-Ray Settings</main>
    <script type="module" src="./index.ts"></script>
  </body>
</html>
```

Create `options/index.ts`:

```ts
// Stub options — replaced by the real settings UI in Phase 7.
const app = document.querySelector('#app');
if (app) app.textContent = 'Ext-Ray settings — coming soon.';
```

- [ ] **Step 3: Verify files exist**

Run: `ls popup/index.html popup/index.ts options/index.html options/index.ts`
Expected: all four paths listed, no error.

- [ ] **Step 4: Commit**

```bash
git add popup/ options/
git commit -m "build: add stub popup + options pages (real UIs land in Phases 6/7)"
```

---

## Task 4: Point the service-worker notification icon at a packaged URL

**Files:**
- Modify: `src/background/index.ts` (one line, inside `runScan`)

- [ ] **Step 1: Update the iconUrl**

In `src/background/index.ts`, change the notification's icon line from:

```ts
      iconUrl: 'icons/icon-128.png',
```

to:

```ts
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
```

(Rationale: the documented, robust form — flagged by the Phase 4 re-verification. No other change.)

- [ ] **Step 2: Typecheck + tests still green**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc OK; `Tests  64 passed (64)`.

- [ ] **Step 3: Commit**

```bash
git add src/background/index.ts
git commit -m "fix: use chrome.runtime.getURL for the guardian notification icon"
```

---

## Task 5: Two-pass Vite build config + scripts

**Files:**
- Modify: `vite.config.ts`
- Modify: `package.json` (scripts)

- [ ] **Step 1: Rewrite `vite.config.ts` with the build passes**

Replace the contents of `vite.config.ts` with:

```ts
import { defineConfig } from 'vitest/config';

// Hand-rolled MV3 build (design spec §3.1). Two passes share this file, selected
// by BUILD_TARGET, and write into one dist/:
//   pages (default): multi-input popup/options; publicDir copies manifest + icons;
//                    emptyOutDir wipes dist first.
//   sw  (BUILD_TARGET=sw): single-input service worker, inlineDynamicImports → one
//                    self-contained background/index.js; appends (emptyOutDir:false).
// `npm test` sets no BUILD_TARGET and ignores the `build`/`publicDir` fields entirely.
const target = process.env.BUILD_TARGET;
const isSw = target === 'sw';

export default defineConfig({
  publicDir: isSw ? false : 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: !isSw,
    target: 'esnext',
    modulePreload: false,
    rollupOptions: isSw
      ? {
          input: { background: 'src/background/index.ts' },
          output: {
            inlineDynamicImports: true,
            entryFileNames: 'background/index.js',
          },
        }
      : {
          input: { popup: 'popup/index.html', options: 'options/index.html' },
          output: {
            entryFileNames: 'assets/[name]-[hash].js',
            chunkFileNames: 'assets/[name]-[hash].js',
            assetFileNames: 'assets/[name]-[hash][extname]',
          },
        },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 2: Add the build scripts**

In `package.json`, add to `scripts` (keep the existing test/typecheck scripts):

```json
    "build": "vite build && BUILD_TARGET=sw vite build",
    "build:watch": "BUILD_TARGET=sw vite build --watch",
    "verify:build": "npm run build && node scripts/check-dist.mjs",
```

(Order matters: the pages pass runs first with `emptyOutDir`, then the SW pass appends. `build:watch` live-rebuilds the SW after an initial `npm run build`; it uses `emptyOutDir:false` so it won't wipe the pages.)

- [ ] **Step 3: Run the build**

Run: `npm run build`
Expected: two Vite build summaries; afterward `dist/` contains `manifest.json`, `icons/`, `background/index.js`, `popup/index.html`, `options/index.html`. Confirm with:
`ls dist dist/background dist/popup dist/options dist/icons`

- [ ] **Step 4: Confirm the SW is self-contained + unit tests still green**

Run: `node -e "const s=require('fs').readFileSync('dist/background/index.js','utf8');console.log('hasImportFrom:', /\\bfrom\\s*['\\\"]/.test(s))"`
Expected: `hasImportFrom: false` (inlineDynamicImports produced a single self-contained file — no sibling-chunk imports).
Run: `npx vitest run`
Expected: `Tests  64 passed (64)` (the config merge didn't disturb the vitest block).

- [ ] **Step 5: Commit**

```bash
git add vite.config.ts package.json
git commit -m "build: two-pass Vite config (pages + self-contained SW) and scripts"
```

---

## Task 6: Post-build verification (`check-dist.mjs`)

**Files:**
- Create: `scripts/check-dist.mjs`

- [ ] **Step 1: Create the checker**

Create `scripts/check-dist.mjs`:

```js
// Asserts the built dist/ satisfies the MV3 "loadable" contract (design spec §4).
// Run after a build: `node scripts/check-dist.mjs` (or `npm run verify:build`).
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const dist = resolve('dist');
let failed = false;
const ok = (m) => console.log(`✓ ${m}`);
const fail = (m) => { console.error(`✗ ${m}`); failed = true; };

const manifestPath = resolve(dist, 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error('✗ dist/manifest.json missing — run `npm run build` first');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.manifest_version === 3 ? ok('manifest_version is 3') : fail('manifest_version is not 3');

const referenced = [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  manifest.options_page,
  ...Object.values(manifest.icons ?? {}),
].filter(Boolean);
for (const rel of referenced) {
  existsSync(resolve(dist, rel)) ? ok(`exists: ${rel}`) : fail(`manifest references missing file: ${rel}`);
}

const swRel = manifest.background?.service_worker;
const sw = swRel ? resolve(dist, swRel) : '';
sw && existsSync(sw) && readFileSync(sw).length > 0
  ? ok('service worker is non-empty')
  : fail('service worker missing or empty');

if (failed) {
  console.error('check-dist: FAILED');
  process.exit(1);
}
console.log('check-dist: OK');
```

- [ ] **Step 2: Run the full verification**

Run: `npm run verify:build`
Expected: build runs, then `check-dist` prints `✓` lines for the manifest, `background/index.js`, both HTML pages, all four icons, and ends with `check-dist: OK` (exit 0).

- [ ] **Step 3: Negative check (the gate actually fails)**

Run: `node -e "require('fs').rmSync('dist/background/index.js')" && node scripts/check-dist.mjs; echo "exit=$?"`
Expected: prints `✗ manifest references missing file: background/index.js` (and/or the non-empty check) and `exit=1`. Then restore with `npm run build`.

- [ ] **Step 4: Commit**

```bash
git add scripts/check-dist.mjs
git commit -m "build: add check-dist.mjs to assert the loadable MV3 contract"
```

---

## Self-review notes (spec coverage)

- §2 decision 1 (hand-rolled, no plugin) → Task 5 (no deps added). §2.2 stub UIs → Task 3. §2.3 placeholder icons → Task 1. §2.4 no HMR (`build` + `build:watch`) → Task 5.
- §3.1 two-pass build (pages + self-contained SW via `inlineDynamicImports`, `BUILD_TARGET`, fixed `background/index.js`, `publicDir`) → Task 5; the self-contained-SW assertion is Task 5 Step 4.
- §3.2 source changes: icons → T1; manifest move + `icons` block → T2; stubs → T3; SW `iconUrl` → `getURL` → T4; scripts → T5.
- §3.3 dist layout + §4 verification (build succeeds, `check-dist`, 64 tests green) → Tasks 5–6.
- §5 boundaries: still 4 permissions (manifest change is only the additive `icons` block); zero new dependencies; no build framework. ✓
- Type/path consistency: `background/index.js` (manifest ↔ SW pass `entryFileNames` ↔ check-dist), `popup/index.html` + `options/index.html` (manifest ↔ pages inputs ↔ check-dist), `BUILD_TARGET=sw` (config ↔ `build` script) all agree.
