# UI Refresh (Phase 9.5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle popup/options/onboarding to the new brand language (navy + cyan tokens, SVG ring gauge with grade words, risk pills, real extension icons) with zero new deps/permissions and the existing e2e selector contract intact.

**Architecture:** One shared OKLCH token file `@import`ed by all three surface stylesheets (Vite inlines it at build). The popup render gains an SVG ring gauge (`createElementNS`, `role="meter"`) and icon `<img>`s fed by a new optional `iconUrl` plumbed pure from the management edge through the report view-model. Everything else is CSS.

**Tech Stack:** Vanilla TS/CSS (OKLCH + relative color syntax, Chrome 120+ baseline), existing Vite build, Vitest, Playwright.

**Spec:** [docs/superpowers/specs/2026-06-11-ui-refresh-design.md](../specs/2026-06-11-ui-refresh-design.md)

**Conventions for every commit:** trailer `Co-Authored-By: Rafael Santos <rafael.santos@tessera.dev>` (never AI attribution). Branch: `ui-refresh`.

---

## File Structure

| File | Responsibility |
|---|---|
| `shared/tokens.css` (create) | OKLCH design tokens (`--er-*`), focus/forced-colors/motion gates. |
| `public/icons/ext-fallback.svg` (create) | Brand-colored generic-extension silhouette (iconless/error fallback). |
| `src/types.ts` (modify) | `iconUrl?: string` on `ExtSnapshot`, `ReportCard`, `ReportRow`. |
| `src/management/management.ts` (modify) + `src/management/management.test.ts` (create) | Pure `pickBestIcon` + `normalize()` plumbs `iconUrl`. |
| `src/report/report.ts` + `report.test.ts` (modify) | Plumb `iconUrl` to cards/rows + tests. |
| `popup/render.ts` (modify) | Ring gauge (`buildGauge`), `GRADE_WORDS`, icon imgs; selectors preserved. |
| `popup/popup.css` (replace) | Token-based restyle. |
| `e2e/popup.spec.ts` (modify) | ADD assertions: `.grade-word`, `.ext-icon` fallback. No existing assertion changes. |
| `options/options.css` (replace), `options/index.html` (verify lang) | Token-based restyle, selectors unchanged. |
| `onboarding/onboarding.css` (replace) + `onboarding/index.html` (hero img only) | Brand hero + check-circle points; selectors/text unchanged. |
| `docs/ROADMAP.md` + `README.md` (modify, last) | Phase 9.5 entry. |

---

## Task 1: Design tokens + fallback icon asset

**Files:** Create `shared/tokens.css`, `public/icons/ext-fallback.svg`.

- [ ] **Step 1: Create `shared/tokens.css`** with EXACTLY:

```css
/* shared/tokens.css — Ext-Ray design system (UI-refresh spec §3.1).
   Two-layer OKLCH tokens, --er- prefixed. Imported FIRST by each surface stylesheet;
   Vite inlines @import at build (no runtime fetch). Chrome 120+ baseline (OKLCH 2023,
   relative color syntax 119). Contrast gates: WCAG 2.2 AA — body text ≥4.5:1, pill
   fills/borders/ring ≥3:1 on their surfaces; cyan is for headings/accents only. */
:root {
  color-scheme: dark;

  /* primitives — navy ramp (tonal elevation: lightness steps, never dark shadows) */
  --er-navy-0: oklch(0.18 0.04 260);
  --er-surface-1: oklch(from var(--er-navy-0) calc(l + 0.05) c h);
  --er-surface-2: oklch(from var(--er-navy-0) calc(l + 0.1) c h);
  --er-border: oklch(1 0 0 / 0.1);
  --er-border-strong: oklch(1 0 0 / 0.18);

  /* text */
  --er-text: oklch(0.93 0.01 250);
  --er-muted: oklch(0.72 0.02 250);

  /* brand accent — desaturated cyan (≈#3EC9D6 class). Headings/accents/focus only. */
  --er-accent: oklch(0.75 0.15 195);
  --er-accent-soft: oklch(0.75 0.15 195 / 0.15);

  /* severity — desaturated for navy, ≥20 L apart, red reserved for the worst tier */
  --er-critical: oklch(0.62 0.19 25);
  --er-high: oklch(0.7 0.15 60);
  --er-medium: oklch(0.78 0.13 95);
  --er-low: oklch(0.76 0.1 220);

  /* grades — arc + letter color (A green → F red) */
  --er-grade-a: oklch(0.78 0.16 155);
  --er-grade-b: oklch(0.8 0.14 120);
  --er-grade-c: var(--er-medium);
  --er-grade-d: var(--er-high);
  --er-grade-f: var(--er-critical);
}

*:focus-visible { outline: 2px solid var(--er-accent); outline-offset: 2px; }

/* Glows are decoration; real borders carry contrast. Map them in forced colors. */
@media (forced-colors: active) {
  *:focus-visible { outline: 2px solid ButtonText; }
}
```

- [ ] **Step 2: Create `public/icons/ext-fallback.svg`** with EXACTLY (a rounded puzzle-piece silhouette in brand colors; renders at any size):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <rect x="1" y="1" width="30" height="30" rx="7" fill="oklch(0.28 0.05 250)"/>
  <path fill="oklch(0.75 0.15 195)" d="M13 7h6a1 1 0 0 1 1 1v3h2.5a2.5 2.5 0 1 1 0 5H20v3h3a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4v-2.5a2.5 2.5 0 1 0-5 0V25H9a1 1 0 0 1-1-1v-6h2.5a2.5 2.5 0 1 0 0-5H8V8a1 1 0 0 1 1-1h4z" opacity="0.9"/>
</svg>
```

- [ ] **Step 3: Verify the SVG ships** — Run: `npm run build && ls dist/icons/ext-fallback.svg`
Expected: file listed (publicDir copies `public/` wholesale).

- [ ] **Step 4: Commit**

```bash
git add shared/tokens.css public/icons/ext-fallback.svg
git commit -m "feat(ui): add OKLCH design tokens + extension-icon fallback asset

Co-Authored-By: Rafael Santos <rafael.santos@tessera.dev>"
```

---

## Task 2: Icon plumbing (pure, TDD)

**Files:** Modify `src/types.ts`, `src/management/management.ts`, `src/report/report.ts`, `src/report/report.test.ts`. Create `src/management/management.test.ts`.

- [ ] **Step 1: Failing tests first.** Create `src/management/management.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pickBestIcon } from './management';

// Research caveats encoded: never icons[0] naively; guard undefined/empty; prefer the
// smallest icon ≥ target; else the largest available.
describe('pickBestIcon', () => {
  const icon = (size: number) => ({ size, url: `chrome://extension-icon/x/${size}` });

  it('returns undefined for undefined input', () => {
    expect(pickBestIcon(undefined, 48)).toBeUndefined();
  });
  it('returns undefined for an empty array', () => {
    expect(pickBestIcon([], 48)).toBeUndefined();
  });
  it('picks the exact size when present', () => {
    expect(pickBestIcon([icon(16), icon(48), icon(128)], 48)).toContain('/48');
  });
  it('picks the smallest size ≥ target (not the largest)', () => {
    expect(pickBestIcon([icon(16), icon(64), icon(128)], 48)).toContain('/64');
  });
  it('falls back to the largest when all are smaller than target', () => {
    expect(pickBestIcon([icon(16), icon(32)], 48)).toContain('/32');
  });
  it('does not assume input order (sorts internally)', () => {
    expect(pickBestIcon([icon(128), icon(16), icon(64)], 48)).toContain('/64');
  });
});
```

Append to `src/report/report.test.ts` (match its existing fixture style — it builds `ExtSnapshot` objects; reuse its helper if present, else inline a minimal snapshot):

```ts
  it('plumbs iconUrl through to risky cards and low rows', () => {
    const withIcon = (id: string, perms: string[], iconUrl?: string) => ({
      id, name: id, version: '1.0.0', enabled: true, type: 'extension',
      installType: 'normal', permissions: perms, hostPermissions: [],
      mayDisable: true, iconUrl,
    });
    const view = buildReport([
      withIcon('risky', ['debugger'], 'chrome://extension-icon/risky/48'),
      withIcon('safe', ['storage'], 'chrome://extension-icon/safe/48'),
      withIcon('noicon', ['storage']),
    ]);
    expect(view.risky[0]!.iconUrl).toBe('chrome://extension-icon/risky/48');
    const safeRow = view.low.find((r) => r.id === 'safe')!;
    const noIconRow = view.low.find((r) => r.id === 'noicon')!;
    expect(safeRow.iconUrl).toBe('chrome://extension-icon/safe/48');
    expect(noIconRow.iconUrl).toBeUndefined();
  });
```

- [ ] **Step 2: Run to confirm RED** — `npx vitest run src/management/management.test.ts src/report/report.test.ts`
Expected: management tests fail with "pickBestIcon is not a function"/module error; report test fails on missing `iconUrl` property.

- [ ] **Step 3: Implement.**

`src/types.ts` — add to `ExtSnapshot` (after `updateUrl?: string;`):
```ts
  /** Best icon URL (chrome://extension-icon/…) picked at the management edge; display-only —
   *  never part of diff() change detection (internal URLs may churn). */
  iconUrl?: string;
```
Add `iconUrl?: string;` to `ReportCard` (after `canDisable: boolean;`) and to `ReportRow` (after `canDisable: boolean;`).

`src/management/management.ts` — add above `normalize`:
```ts
/** Smallest declared icon ≥ target px, else the largest available (HiDPI-friendly).
 *  Never icons[0] (manifest order is usually smallest-first); never hand-built URLs. */
export function pickBestIcon(
  icons: Array<{ size: number; url: string }> | undefined,
  target: number,
): string | undefined {
  if (!icons || icons.length === 0) return undefined;
  const sorted = [...icons].sort((a, b) => a.size - b.size);
  return (sorted.find((i) => i.size >= target) ?? sorted[sorted.length - 1])!.url;
}
```
In `normalize()`, add `iconUrl: pickBestIcon(e.icons, 48),` after `updateUrl: e.updateUrl,`.

`src/report/report.ts` — in `buildReport`, add `iconUrl: snapshot.iconUrl,` to BOTH the `low.push({...})` and `risky.push({...})` object literals.

- [ ] **Step 4: GREEN + full suite** — `npm run typecheck && npm test`
Expected: tsc clean; all tests pass (86 prior + 6 pickBestIcon + 1 report = 93).

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/management/management.ts src/management/management.test.ts src/report/report.ts src/report/report.test.ts
git commit -m "feat(report): plumb best-fit extension icon URLs to the view-model (TDD)

Co-Authored-By: Rafael Santos <rafael.santos@tessera.dev>"
```

---

## Task 3: Popup restyle (ring gauge, pills, icons)

**Files:** Modify `popup/render.ts`, replace `popup/popup.css`, modify `e2e/popup.spec.ts` (ADD two tests only).

- [ ] **Step 1: `popup/render.ts` changes** (surgical; keep everything not mentioned):

(a) Extend the imports line to include `FleetGrade` and `Grade`:
```ts
import type { ReportView, ReportCard, ReportRow, Tier, FleetGrade, Grade } from '../src/types';
```

(b) After the `TIER_LABEL` const, add:
```ts
const GRADE_WORDS: Record<Grade, string> = {
  A: 'Excellent', B: 'Good', C: 'Fair', D: 'Poor', F: 'At Risk',
};

const ICON_FALLBACK = '../icons/ext-fallback.svg';
const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag: string, attrs: Record<string, string>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

// Ring gauge (spec §3.2): SVG stroke ring, fill = fleet safety (A ≈ full, F ≈ minimal),
// arc colored by grade token. role=meter wrapper carries the semantics; SVG is decorative.
function buildGauge(grade: FleetGrade): HTMLElement {
  const C = 2 * Math.PI * 45; // r=45 in a 100×100 viewBox
  const wrap = el('div', `gauge grade-${grade.grade.toLowerCase()}`);
  wrap.setAttribute('role', 'meter');
  wrap.setAttribute('aria-valuemin', '0');
  wrap.setAttribute('aria-valuemax', '100');
  wrap.setAttribute('aria-valuenow', String(Math.round((1 - grade.score) * 100)));
  wrap.setAttribute('aria-valuetext', `${grade.grade} – ${GRADE_WORDS[grade.grade]}`);
  wrap.setAttribute('aria-labelledby', 'gauge-letter');

  const svg = svgEl('svg', { viewBox: '0 0 100 100', 'aria-hidden': 'true' });
  svg.append(svgEl('circle', { class: 'gauge-track', cx: '50', cy: '50', r: '45' }));
  const g = svgEl('g', { class: 'gauge-glow' });
  const arc = svgEl('circle', { class: 'gauge-arc', cx: '50', cy: '50', r: '45' });
  arc.style.setProperty('stroke-dasharray', String(C));
  // offset = C×score (capped so even an F keeps a visible 4% arc)
  arc.style.setProperty('stroke-dashoffset', String(Math.min(C * 0.96, C * grade.score)));
  g.append(arc);
  svg.append(g);
  wrap.append(svg);

  const overlay = el('div', 'gauge-text');
  const letter = el('span', `grade grade-${grade.grade.toLowerCase()}`, grade.grade);
  letter.id = 'gauge-letter';
  overlay.append(letter, el('span', 'grade-word', GRADE_WORDS[grade.grade]));
  wrap.append(overlay);
  return wrap;
}

function iconImg(url: string | undefined, size: number): HTMLImageElement {
  const img = document.createElement('img');
  img.className = 'ext-icon';
  img.width = size;
  img.height = size;
  img.alt = '';
  img.src = url ?? ICON_FALLBACK;
  img.addEventListener('error', () => { img.src = ICON_FALLBACK; }, { once: true });
  return img;
}
```

(c) In `renderReport`, replace the header block
```ts
  const header = el('header', 'header');
  header.append(el('div', `grade grade-${view.grade.grade.toLowerCase()}`, view.grade.grade));
```
with:
```ts
  const header = el('header', 'header');
  header.append(buildGauge(view.grade));
```
and replace `meta.append(el('div', 'app-title', 'Ext-Ray'), …)` so the title row carries the logo:
```ts
  const title = el('div', 'app-title');
  const logo = document.createElement('img');
  logo.src = '../icons/icon-32.png'; logo.width = 20; logo.height = 20; logo.alt = '';
  title.append(logo, document.createTextNode('Ext-Ray'));
  meta.append(
    title,
    el('div', 'summary',
      view.counts.total === 0
        ? 'No other extensions installed.'
        : `${view.counts.risky} need a look · ${view.counts.low} low-risk`),
    el('div', 'grade-caption', 'Overall security grade'),
  );
```

(d) In `renderCard`, insert the icon as the FIRST child of the head row:
```ts
  const head = el('div', 'card-head');
  head.append(
    iconImg(card.iconUrl, 32),
    el('span', 'dot'),
    …existing children unchanged…
  );
```
(e) In `renderRow`, change the row append to lead with the icon:
```ts
  r.append(iconImg(row.iconUrl, 24), el('span', 'dot'), el('span', 'name', row.name));
```

- [ ] **Step 2: Replace `popup/popup.css`** with EXACTLY:

```css
@import '../shared/tokens.css';

* { box-sizing: border-box; }
body { margin: 0; width: 360px; font: 13px/1.45 system-ui, sans-serif;
  background: var(--er-navy-0); color: var(--er-text); }
#app { padding: 12px; }
#app.loading { color: var(--er-muted); }

.header { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; }

/* ── ring gauge ─────────────────────────────────────────────────────────── */
.gauge { position: relative; width: 84px; height: 84px; flex: none; }
.gauge svg { width: 100%; height: 100%; transform: rotate(-90deg); }
.gauge-track { fill: none; stroke: oklch(1 0 0 / 0.12); stroke-width: 8; }
.gauge-arc { fill: none; stroke-width: 8; stroke-linecap: round; }
.gauge-glow { filter: drop-shadow(0 0 5px currentColor); }
.gauge.grade-a { color: var(--er-grade-a); } .gauge.grade-b { color: var(--er-grade-b); }
.gauge.grade-c { color: var(--er-grade-c); } .gauge.grade-d { color: var(--er-grade-d); }
.gauge.grade-f { color: var(--er-grade-f); }
.gauge-arc { stroke: currentColor; }
.gauge-text { position: absolute; inset: 0; display: grid; place-content: center;
  text-align: center; transform: none; }
.gauge-text .grade { font-size: 26px; font-weight: 700; line-height: 1; }
.grade-a { color: var(--er-grade-a); } .grade-b { color: var(--er-grade-b); }
.grade-c { color: var(--er-grade-c); } .grade-d { color: var(--er-grade-d); }
.grade-f { color: var(--er-grade-f); }
.grade-word { font-size: 9px; font-weight: 700; letter-spacing: .08em;
  text-transform: uppercase; color: var(--er-muted); margin-top: 2px; }

.app-title { font-weight: 600; display: flex; align-items: center; gap: 6px; font-size: 14px; }
.app-title img { border-radius: 4px; }
.summary { color: var(--er-muted); font-size: 12px; margin-top: 2px; }
.grade-caption { color: var(--er-muted); font-size: 10px; text-transform: uppercase;
  letter-spacing: .06em; margin-top: 4px; }

/* ── cards ──────────────────────────────────────────────────────────────── */
.card { background: var(--er-surface-1); border: 1px solid var(--er-border);
  border-left: 3px solid var(--er-low); border-radius: 10px; padding: 10px; margin-bottom: 8px; }
.card.tier-critical { border-left-color: var(--er-critical); }
.card.tier-high { border-left-color: var(--er-high); }
.card.tier-medium { border-left-color: var(--er-medium); }
@media (prefers-reduced-motion: no-preference) {
  .card { transition: border-color .15s, box-shadow .15s; }
}
.card.tier-critical:hover, .card.tier-high:hover {
  border-color: var(--er-border-strong);
  box-shadow: 0 0 0 1px var(--er-accent-soft), 0 0 16px 4px var(--er-accent-soft);
}

.card-head { display: flex; align-items: center; gap: 8px; }
.ext-icon { border-radius: 6px; background: var(--er-surface-2); flex: none; }
.is-disabled .ext-icon { filter: grayscale(1) opacity(.45); }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--er-low); flex: none; }
.tier-critical .dot { background: var(--er-critical); }
.tier-high .dot { background: var(--er-high); }
.tier-medium .dot { background: var(--er-medium); }

/* tier label restyled as a pill — same class/text, three redundant cues total */
.tier-label { display: inline-flex; align-items: center; border-radius: 9999px;
  padding: 2px 9px; font-size: 10px; font-weight: 700; text-transform: uppercase;
  letter-spacing: .05em; background: var(--er-surface-2);
  border: 1px solid var(--er-border-strong); color: var(--er-muted); }
.tier-critical .tier-label { background: oklch(from var(--er-critical) l c h / 0.16);
  border-color: oklch(from var(--er-critical) l c h / 0.45); color: oklch(from var(--er-critical) calc(l + 0.16) c h); }
.tier-high .tier-label { background: oklch(from var(--er-high) l c h / 0.16);
  border-color: oklch(from var(--er-high) l c h / 0.45); color: oklch(from var(--er-high) calc(l + 0.14) c h); }
.tier-medium .tier-label { background: oklch(from var(--er-medium) l c h / 0.16);
  border-color: oklch(from var(--er-medium) l c h / 0.45); color: oklch(from var(--er-medium) calc(l + 0.1) c h); }
.tier-low .tier-label { background: oklch(from var(--er-low) l c h / 0.16);
  border-color: oklch(from var(--er-low) l c h / 0.45); color: oklch(from var(--er-low) calc(l + 0.12) c h); }

.name { font-weight: 600; }
.version { color: var(--er-muted); font-size: 11px; }
.reason { margin: 6px 0 0; color: var(--er-text); }
.warning { margin: 6px 0 0; color: var(--er-muted); font-style: italic; }
.warning:empty { display: none; }

.actions { display: flex; gap: 8px; margin-top: 10px; }
.btn { font: inherit; font-size: 12px; padding: 4px 12px; border-radius: 7px;
  border: 1px solid var(--er-border-strong); background: var(--er-surface-2);
  color: var(--er-text); cursor: pointer; }
.btn:hover { border-color: var(--er-accent); }
.btn-remove { background: transparent; }
.managed { color: var(--er-muted); font-size: 12px; }
.is-disabled { opacity: .55; }

.low-section { margin-top: 10px; }
.low-title { font-size: 10px; text-transform: uppercase; letter-spacing: .06em;
  color: var(--er-muted); margin: 8px 0 4px; }
.row { display: flex; align-items: center; gap: 8px; padding: 6px 4px;
  border-radius: 8px; }
.row .name { font-weight: 400; flex: 1; }
.row .actions { margin-top: 0; }

.limits { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--er-border);
  color: var(--er-muted); font-size: 11px; }
.error { padding: 16px; color: var(--er-critical); }

@media (forced-colors: active) {
  .card, .tier-label, .btn { border: 1px solid ButtonText; box-shadow: none; }
}
```

- [ ] **Step 3: ADD two e2e tests** to `e2e/popup.spec.ts` (change NOTHING existing):

```ts
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
```

- [ ] **Step 4: Verify** — `npm run typecheck && npm test && npm run build && npx playwright test e2e/popup.spec.ts e2e/smoke.spec.ts`
Expected: tsc clean; 93 unit green; popup spec now 7 passed (5 existing + 2 new) + smoke 3 — the existing assertions (`.grade` text/class, summary, cards, footer, disable, remove, is-disabled) must pass UNCHANGED. If an existing assertion fails, STOP and report (selector contract broken = design bug).

- [ ] **Step 5: Commit**

```bash
git add popup/render.ts popup/popup.css e2e/popup.spec.ts
git commit -m "feat(popup): brand restyle — ring gauge, grade words, risk pills, extension icons

Co-Authored-By: Rafael Santos <rafael.santos@tessera.dev>"
```

---

## Task 4: Options restyle (CSS only)

**Files:** Replace `options/options.css`. Verify `options/index.html` has `lang="en"` on `<html>` (add if missing — attribute only, nothing else).

- [ ] **Step 1: Replace `options/options.css`** with EXACTLY:

```css
@import '../shared/tokens.css';

* { box-sizing: border-box; }
body { margin: 0; width: 420px; font: 14px/1.5 system-ui, sans-serif;
  background: var(--er-navy-0); color: var(--er-text); }
#app { padding: 18px; }
.title { font-size: 18px; margin: 0 0 14px; display: flex; align-items: center; gap: 8px; }
.row { display: flex; align-items: center; gap: 10px; padding: 8px 0; cursor: pointer; }
.row .label { flex: 1; }
input[type="checkbox"] { accent-color: var(--er-accent); width: 15px; height: 15px; }
.cadence { font: inherit; background: var(--er-surface-2); color: var(--er-text);
  border: 1px solid var(--er-border-strong); border-radius: 7px; padding: 4px 8px; }
.ignore-section, .support-section { margin-top: 16px; padding-top: 12px;
  border-top: 1px solid var(--er-border); }
.section-title { font-size: 11px; text-transform: uppercase; letter-spacing: .05em;
  color: var(--er-accent); margin: 0 0 6px; }
.note { color: var(--er-muted); }
.error { padding: 16px; color: var(--er-critical); }

.btc-row { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
.btc-address { font: 11px/1.4 ui-monospace, monospace; background: var(--er-surface-1);
  border: 1px solid var(--er-border); border-radius: 7px; padding: 6px 8px; flex: 1;
  word-break: break-all; user-select: all; }
.btn-copy { font: inherit; font-size: 12px; padding: 5px 14px; border-radius: 7px;
  border: 1px solid var(--er-border-strong); background: var(--er-surface-2);
  color: var(--er-text); cursor: pointer; }
.btn-copy:hover { border-color: var(--er-accent); }

@media (forced-colors: active) {
  .cadence, .btc-address, .btn-copy { border: 1px solid ButtonText; }
}
```

- [ ] **Step 2: Verify** — `npm run build && npx playwright test e2e/options.spec.ts`
Expected: 4 passed (incl. the 420px no-overflow test).

- [ ] **Step 3: Commit**

```bash
git add options/options.css options/index.html
git commit -m "style(options): token-based brand restyle

Co-Authored-By: Rafael Santos <rafael.santos@tessera.dev>"
```

---

## Task 5: Onboarding restyle

**Files:** Replace `onboarding/onboarding.css`; in `onboarding/index.html` change ONLY the hero `<img>` line to the 128px logo at a 64px box:
`<img src="../icons/icon-128.png" alt="" width="64" height="64" />`
(All text, headings, links, ids unchanged — e2e contract.)

- [ ] **Step 1: Replace `onboarding/onboarding.css`** with EXACTLY:

```css
@import '../shared/tokens.css';

* { box-sizing: border-box; }
body { margin: 0; font: 15px/1.6 system-ui, sans-serif;
  background: var(--er-navy-0); color: var(--er-text); }
.onboard { max-width: 720px; margin: 0 auto; padding: 48px 24px; }

.hero { text-align: center; margin-bottom: 32px; }
.hero img { border-radius: 14px; box-shadow: 0 0 0 1px var(--er-border),
  0 0 24px 6px var(--er-accent-soft); }
.hero h1 { margin: 14px 0 4px; font-size: 26px; }
.tagline { color: var(--er-muted); margin: 0; }

.points { display: grid; gap: 12px; }
.point { background: var(--er-surface-1); border: 1px solid var(--er-border);
  border-radius: 12px; padding: 16px 18px 16px 52px; position: relative; }
.point::before { content: ""; position: absolute; left: 16px; top: 18px;
  width: 22px; height: 22px; border-radius: 50%;
  border: 1.5px solid var(--er-accent);
  background:
    no-repeat center / 12px 12px
    url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12"><path d="M2 6.5 5 9.5 10 3" fill="none" stroke="%233EC9D6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>');
}
.point h2 { margin: 0 0 6px; font-size: 15px; }
.point p { margin: 0; color: var(--er-muted); }

.next { margin-top: 24px; }
.next h2 { font-size: 15px; margin: 0 0 6px; color: var(--er-accent); }
.next p { margin: 0; color: var(--er-muted); }

.foot { margin-top: 32px; display: flex; align-items: center; justify-content: space-between; }
.foot a { color: var(--er-muted); }
.btn { font: inherit; padding: 9px 24px; border-radius: 9px;
  border: 1px solid var(--er-border-strong);
  background: var(--er-accent-soft); color: var(--er-text); cursor: pointer; }
.btn:hover { border-color: var(--er-accent); }

@media (forced-colors: active) {
  .point, .btn { border: 1px solid ButtonText; box-shadow: none; }
  .point::before { border-color: ButtonText; }
}
```

(The check-mark data-URL is a static inline SVG **in CSS** — not script; CSP-safe. `%23` = `#` in the stroke hex.)

- [ ] **Step 2: Verify** — `npm run build && npx playwright test e2e/onboarding.spec.ts`
Expected: 1 passed (text/selector assertions unchanged).

- [ ] **Step 3: Commit**

```bash
git add onboarding/onboarding.css onboarding/index.html
git commit -m "style(onboarding): brand hero + check-circle points

Co-Authored-By: Rafael Santos <rafael.santos@tessera.dev>"
```

---

## Task 6: Full verification + visual checkpoint + close-out

**Files:** Modify `docs/ROADMAP.md`, `README.md`.

- [ ] **Step 1:** `npm run typecheck && npm test && npm run test:e2e && npm run verify:build`
Expected: tsc clean · 93 unit · **16 e2e** (14 prior + 2 new popup) · check-dist OK (4-permission invariant intact).

- [ ] **Step 2: Visual checkpoint** — render popup (with a varied fixture fleet), options, onboarding to PNGs and EYEBALL against the brand art (controller does this; failure = iterate before close-out).

- [ ] **Step 3: ROADMAP** — add a Phase 9.5 row (✅) under Phase 9: "UI refresh — shared OKLCH tokens, SVG ring gauge (role=meter, grade words A Excellent…F At Risk), risk pills, real extension icons via ExtensionInfo.icons (zero new permissions), WCAG 2.2 AA pass; product now matches store screenshots + promo art." Update "Where we are" lead sentence accordingly. README: refresh the status blurb test counts (93 unit + 16 e2e) and mention the refreshed UI.

- [ ] **Step 4: Commit**

```bash
git add docs/ROADMAP.md README.md
git commit -m "docs: record Phase 9.5 UI refresh

Co-Authored-By: Rafael Santos <rafael.santos@tessera.dev>"
```

- [ ] **Step 5:** Finish branch (final review → ff-merge `ui-refresh` → main → push), then regenerate `npm run shots`, copy to the desktop screenshots folder, and refresh the desktop ZIP + unpacked `ext-ray` folder.

---

## Self-Review

**Spec coverage:** §3.1→Task 1; §3.3→Task 2; §3.2→Task 3; §3.4→Tasks 4–5; §4→Tasks 3–6 (selector
contract, new tests, verify:build, visual checkpoint, screenshots). ✓
**Placeholders:** none — full literal file contents everywhere. ✓
**Consistency:** `pickBestIcon(icons, 48)` matches the test import path (`./management`);
`iconUrl` optional everywhere (types→normalize→report→render `card.iconUrl ?? ICON_FALLBACK`);
`.grade`/`.grade-f` classes preserved on the letter span (e2e `toHaveText`/`toHaveClass` intact);
`.tier-label` text unchanged (existing `toHaveText('Critical')` intact); options/onboarding
selectors untouched; `el()` helper exists in both render files; `FleetGrade`/`Grade` are exported
from src/types.ts. Unit math: 86 + 6 + 1 = 93; e2e 14 + 2 = 16. ✓
