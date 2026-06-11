# Ext-Ray Phase 5 — MV3 Build Pipeline Design

- **Date:** 2026-06-06
- **Status:** Approved design, pre-implementation
- **Elaborates:** main [design spec](2026-06-05-ext-ray-design.md) §2 (Deployment), §10; [roadmap](../../ROADMAP.md) Phase 5 (incl. the Phase 4 re-verification notes: ship `icon-128`, use `chrome.runtime.getURL` for the notification iconUrl)

## 1. Summary

Phase 5 makes Ext-Ray actually loadable in a browser. `npm run build` produces a Manifest V3
`dist/` containing the bundled service worker, stub popup/options pages, the manifest, and a
placeholder icon set — installable as an unpacked extension, with the guardian running live.
It adds **zero new dependencies** (Vite is already present); this matches the product's defining
supply-chain constraint and keeps the build chain small and auditable.

## 2. Decisions (from brainstorming, 2026-06-06)

1. **Hand-rolled Vite multi-entry config — no build framework/plugin.** WXT is the 2025–26
   gold-standard framework, but its strengths (cross-browser, rich HMR, framework UIs) don't
   apply here: Ext-Ray is Chromium-only (spec §3), has no content scripts, and ships vanilla-TS
   UIs. CRXJS is maintenance-uncertain. A focused, dependency-free Vite config is the principled
   fit for a security tool whose value rests on minimal, auditable dependencies.
2. **Stub popup + options so the extension loads end-to-end.** Phase 5 ships minimal placeholder
   pages so the full manifest is valid and installable; real UIs replace them in Phases 6/7.
3. **Placeholder icons now, branding in Phase 9.** A simple geometric glyph set (16/32/48/128),
   clearly marked as placeholder.
4. **No HMR.** `vite build` + `vite build --watch` for the dev loop. Reload-the-extension is
   sufficient for these simple surfaces.

## 3. Architecture

Hand-rolled Vite build, configured in the existing `vite.config.ts` (the vitest `test` block and
the new `build` block coexist in one `defineConfig`).

### 3.1 Build configuration — two passes (`vite.config.ts`)

The service worker is built **separately and self-contained** from the HTML pages. This dodges
the well-known MV3 footgun where Vite rewrites code-split *dynamic* imports to inject a
`document`-based preload step that throws in a worker (there is no `document` in a service
worker) [Vite #3311], and it keeps the SW a single auditable file. `inlineDynamicImports`
(which forces a single self-contained chunk) cannot be set on a multi-input build [Vite #16241],
so the SW gets its own pass. One `npm run build` runs both passes into the same `dist/`; the
config selects the pass via a `BUILD_TARGET` env var.

- **Pass A — pages** (multi-input): `rollupOptions.input = { popup: 'popup/index.html', options:
  'options/index.html' }`; `outDir: 'dist'`, `emptyOutDir: true`, `publicDir: 'public'` (copies
  `manifest.json` + `icons/` verbatim to `dist/` root — no plugin, no copy script);
  `entryFileNames`/`chunkFileNames`/`assetFileNames` → `'assets/[name]-[hash][extname]'`. Vite
  emits the HTML at `dist/popup/index.html` + `dist/options/index.html` and rewrites their script tags.
- **Pass B — service worker** (single input): `rollupOptions.input = { background:
  'src/background/index.ts' }` with `output.inlineDynamicImports: true` and `output.entryFileNames:
  'background/index.js'` (fixed, manifest-referenced, unhashed); `emptyOutDir: false` (append to the
  `dist/` from Pass A), `publicDir: false` (Pass A already copied the statics). Result: one
  self-contained `dist/background/index.js` — no sibling-chunk imports, no preload injection.
- **Shared options (both passes):** `target: 'esnext'` (Chrome 120+), `modulePreload: false`, ESM output.
- The `test` block is unchanged (`environment: 'node'`, `include: ['src/**/*.test.ts']`), so the
  64 existing unit tests keep running exactly as before. The build passes read `BUILD_TARGET`; the
  test run sets neither and is unaffected.

### 3.2 Source layout changes

- **`manifest.json` moves to `public/manifest.json`** (its build-source location) and gains an
  `icons` block: `{ "16": "icons/icon-16.png", "32": ..., "48": ..., "128": ... }`. Permissions
  (the 4 non-host) and the background/action/options entries are otherwise unchanged.
- **`public/icons/icon-{16,32,48,128}.png`** — placeholder glyph set.
- **`popup/index.html` + `popup/index.ts`** and **`options/index.html` + `options/index.ts`** —
  minimal stubs (a heading + one line of text set by the tiny script, e.g. "Ext-Ray — full report
  coming soon"). Placed at the project root so Vite emits them at `dist/popup/index.html` and
  `dist/options/index.html` (HTML output path mirrors the input path relative to root). Shared
  logic stays in `src/`; these are the only root-level UI entry files.
- **`src/background/index.ts`**: change the notification `iconUrl` from the bare relative path to
  `chrome.runtime.getURL('icons/icon-128.png')` (the robust, documented form; the roadmap's Phase 4
  re-verification flagged this). One-line change to already-merged glue.
- **`package.json` scripts:** add `"build": "vite build"` and `"build:watch": "vite build --watch"`.
- **`.gitignore`** already ignores `dist/`.

### 3.3 Resulting `dist/` layout

```
dist/
  manifest.json
  icons/icon-{16,32,48,128}.png
  background/index.js          (bundled ESM service worker)
  popup/index.html  + assets/*.js
  options/index.html + assets/*.js
  assets/*.js                  (shared chunks, if any)
```

## 4. Verification

Build configuration is not unit-TDD-able, so Phase 5's gate is explicit and honest:

- **`npm run build` succeeds** (a missing entry or broken import fails the build — the primary gate).
- **`node scripts/check-dist.mjs`** (run as `npm run build && node scripts/check-dist.mjs`, also
  exposed as a `verify:build` script) asserts the loadable contract:
  - `dist/manifest.json` exists, is valid JSON, `manifest_version === 3`, and every path it
    references (`background.service_worker`, `action.default_popup`, `options_page`, all `icons`)
    exists on disk in `dist/`.
  - `dist/background/index.js` exists and is non-empty.
  - exits non-zero with a clear message on any failure.
- **The 64 existing unit tests stay green** (`npm test`) — proves the `vite.config.ts` merge didn't
  disturb the vitest block.
- **Actual load-unpacked in Chrome/Edge is Phase 8** (Playwright), not Phase 5.

## 5. Boundaries / non-goals (YAGNI)

- Still exactly **4 permissions**, no host permissions, no content scripts. The only manifest change
  is the additive `icons` block.
- **No build framework** (WXT/CRXJS/Plasmo), **no HMR tooling**, **no runtime dependencies** shipped.
- Stub popup/options carry no real functionality — they exist only to make the manifest valid and the
  extension loadable; Phases 6/7 replace them.
- Placeholder icons are not final branding (Phase 9).
- No store packaging/zip step yet (Phase 9).

## 6. Resolved during pre-implementation research (2026-06)

- **Self-contained service worker (the SW code-splitting footgun).** An online check confirmed the
  #1 hand-rolled-MV3-Vite hazard: Vite's preload rewrite for code-split *dynamic* imports references
  `document`, which a service worker lacks, so it throws at runtime; and `inlineDynamicImports`
  can't be set on a multi-input build [Vite #3311, #16241]. Resolved by the two-pass build (§3.1) —
  the SW is its own single-input, `inlineDynamicImports` build, yielding one self-contained file.
  This also future-proofs Phases 6/7, where the popup/options will import shared `src/` logic: the
  SW stays independent instead of coupling to page chunks.
- **No-plugin pattern confirmed.** The `entryFileNames`-fixed-name + `publicDir`-for-`manifest.json`
  approach is the standard 2025–26 hand-rolled setup; Vite 6 is appropriate (no need for a newer
  major for this build).
