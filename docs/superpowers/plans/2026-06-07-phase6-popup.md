# Phase 6 — Popup Report UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the popup on-demand audit — open → score every installed extension → show an A–F fleet grade, full cards for risky extensions (reasons + browser warnings + Disable/Remove) and compact rows for the benign many, with an honest-limits footer.

**Architecture:** A pure `report/buildReport` (all logic: score, worst-first sort, risky/low partition) feeds a dumb `render` (data→DOM, no logic) driven by a thin `popup/index.ts` controller; three new `management` edge wrappers do the `chrome.*` actions. Vanilla TS + CSS, no framework. Spec: `docs/superpowers/specs/2026-06-07-phase6-popup-design.md`.

**Tech Stack:** TypeScript, Vite (already configured), Vitest. Reuses `scoring/`, `management/`.

---

## File structure

| File | Responsibility |
|---|---|
| `src/types.ts` (modify) | `ReportCard`, `ReportRow`, `ReportView` |
| `src/report/report.ts` (create) + `.test.ts` | Pure `buildReport` — the TDD target |
| `src/management/management.ts` (modify) + `.test.ts` | `getPermissionWarningsById`, `setEnabled`, `uninstall` |
| `tsconfig.json` (modify) | Add `popup` to `include` so the UI TS is type-checked |
| `popup/index.html` (replace stub) | Popup shell (root + CSS link + script) |
| `popup/render.ts` (create) | Dumb `ReportView` → DOM (+ `renderError`) |
| `popup/popup.css` (create) | Styling (grade header, tier colors, cards, rows, footer) |
| `popup/index.ts` (replace stub) | Controller: load → buildReport → render → actions → C1 warnings |

`render`, `popup.css`, and the controller carry no unit tests (per spec §8 — kept logic-free; exercised in Phase 8 Playwright). Gate for those tasks: `npm run verify:build` + `tsc` + the 64 existing tests stay green.

---

## Task 1: Add Phase 6 types

**Files:** Modify `src/types.ts` (append at end)

- [ ] **Step 1: Append the types**

Add to the end of `src/types.ts`:

```ts
// ── Phase 6: popup report view model ──────────────────────────────────────────

export interface ReportCard {
  id: string;
  name: string;
  version: string;
  tier: Tier;          // 'critical' | 'high' | 'medium' (cards are tier ≥ medium)
  score: number;       // [0,1]
  reasons: string[];
  enabled: boolean;
  canDisable: boolean; // = mayDisable
}

export interface ReportRow {
  id: string;
  name: string;
  tier: Tier;          // 'low'
  enabled: boolean;
  canDisable: boolean;
}

export interface ReportView {
  grade: FleetGrade;
  risky: ReportCard[]; // worst-first
  low: ReportRow[];    // worst-first
  counts: { total: number; risky: number; low: number };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: OK (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add Phase 6 popup view-model types

Co-Authored-By: Rafael Santos <rafael.santos@tessera.dev>"
```

---

## Task 2: `report/buildReport` (pure)

**Files:** Create `src/report/report.test.ts`, `src/report/report.ts`

- [ ] **Step 1: Write the failing test**

Create `src/report/report.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { ExtSnapshot } from '../types';
import { buildReport } from './report';

function ext(o: Partial<ExtSnapshot> = {}): ExtSnapshot {
  return {
    id: 'a'.repeat(32), name: 'X', version: '1.0.0', enabled: true, type: 'extension',
    installType: 'normal', permissions: [], hostPermissions: [], mayDisable: true, ...o,
  };
}

describe('buildReport', () => {
  it('grades an empty fleet as A with empty lists', () => {
    const r = buildReport([]);
    expect(r.grade.grade).toBe('A');
    expect(r.risky).toEqual([]);
    expect(r.low).toEqual([]);
    expect(r.counts).toEqual({ total: 0, risky: 0, low: 0 });
  });

  it('partitions risky (tier ≥ medium) from low, worst-first', () => {
    const crit = ext({ id: 'c'.repeat(32), name: 'Crit', hostPermissions: ['<all_urls>'] }); // critical
    const med = ext({ id: 'm'.repeat(32), name: 'Med', permissions: ['tabs'] });              // medium
    const low = ext({ id: 'l'.repeat(32), name: 'Low' });                                     // low
    const r = buildReport([low, med, crit]);
    expect(r.risky.map((c) => c.id)).toEqual(['c'.repeat(32), 'm'.repeat(32)]); // score desc
    expect(r.low.map((x) => x.id)).toEqual(['l'.repeat(32)]);
    expect(r.counts).toEqual({ total: 3, risky: 2, low: 1 });
  });

  it('passes plain-English reasons through to risky cards', () => {
    const r = buildReport([ext({ hostPermissions: ['<all_urls>'] })]);
    expect(r.risky[0].reasons.length).toBeGreaterThan(0);
    expect(r.risky[0].tier).toBe('critical');
  });

  it('carries enabled + canDisable (from mayDisable) onto cards and rows', () => {
    const r = buildReport([
      ext({ id: 'c'.repeat(32), hostPermissions: ['<all_urls>'], enabled: false, mayDisable: false }),
      ext({ id: 'l'.repeat(32), enabled: true, mayDisable: true }),
    ]);
    expect(r.risky[0].enabled).toBe(false);
    expect(r.risky[0].canDisable).toBe(false);
    expect(r.low[0].enabled).toBe(true);
    expect(r.low[0].canDisable).toBe(true);
  });

  it('breaks score ties by name for determinism', () => {
    const a = ext({ id: 'a'.repeat(32), name: 'Zeta', permissions: ['tabs'] });
    const b = ext({ id: 'b'.repeat(32), name: 'Alpha', permissions: ['tabs'] });
    const r = buildReport([a, b]);
    expect(r.risky.map((c) => c.name)).toEqual(['Alpha', 'Zeta']);
    expect(buildReport([a, b])).toEqual(buildReport([b, a])); // order-independent
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/report/report.test.ts`
Expected: FAIL — `Cannot find module './report'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/report/report.ts`:

```ts
// report/ — pure popup view-model builder (design spec §3.1). No I/O.
// Scores each extension, grades the fleet, sorts worst-first, and partitions
// into full "risky" cards (tier ≥ medium) and compact "low" rows. All popup
// logic lives here so the render layer is a dumb data→DOM map.

import type { ExtSnapshot, ReportView, ReportCard, ReportRow } from '../types';
import { scoreExtension, gradeFleet } from '../scoring/scoring';

export function buildReport(snapshots: ExtSnapshot[]): ReportView {
  const scored = snapshots.map((snapshot) => ({ snapshot, verdict: scoreExtension(snapshot) }));
  const grade = gradeFleet(scored.map((x) => x.verdict));

  // Worst-first: score descending, ties broken by name ascending (determinism).
  scored.sort((a, b) => b.verdict.score - a.verdict.score || a.snapshot.name.localeCompare(b.snapshot.name));

  const risky: ReportCard[] = [];
  const low: ReportRow[] = [];
  for (const { snapshot, verdict } of scored) {
    if (verdict.tier === 'low') {
      low.push({
        id: snapshot.id, name: snapshot.name, tier: verdict.tier,
        enabled: snapshot.enabled, canDisable: snapshot.mayDisable,
      });
    } else {
      risky.push({
        id: snapshot.id, name: snapshot.name, version: snapshot.version, tier: verdict.tier,
        score: verdict.score, reasons: verdict.reasons,
        enabled: snapshot.enabled, canDisable: snapshot.mayDisable,
      });
    }
  }

  return { grade, risky, low, counts: { total: snapshots.length, risky: risky.length, low: low.length } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/report/report.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/report/report.ts src/report/report.test.ts
git commit -m "feat: pure popup report builder (score, worst-first, risky/low partition)

Co-Authored-By: Rafael Santos <rafael.santos@tessera.dev>"
```

---

## Task 3: `management/` edge — action wrappers

**Files:** Modify `src/management/management.ts` (append), `src/management/management.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `src/management/management.test.ts`:

```ts
import { getPermissionWarningsById, setEnabled, uninstall } from './management';

describe('management actions', () => {
  it('getPermissionWarningsById returns the browser warnings for an id', async () => {
    const calls: string[] = [];
    (globalThis as unknown as { chrome: unknown }).chrome = {
      management: {
        getPermissionWarningsById: async (id: string) => { calls.push(id); return ['Read your data on all websites']; },
      },
    };
    expect(await getPermissionWarningsById('b'.repeat(32))).toEqual(['Read your data on all websites']);
    expect(calls).toEqual(['b'.repeat(32)]);
  });

  it('setEnabled calls through with the id and flag', async () => {
    const calls: Array<[string, boolean]> = [];
    (globalThis as unknown as { chrome: unknown }).chrome = {
      management: { setEnabled: async (id: string, on: boolean) => { calls.push([id, on]); } },
    };
    await setEnabled('b'.repeat(32), false);
    expect(calls).toEqual([['b'.repeat(32), false]]);
  });

  it('uninstall requests Chrome’s native confirm dialog', async () => {
    const calls: Array<[string, unknown]> = [];
    (globalThis as unknown as { chrome: unknown }).chrome = {
      management: { uninstall: async (id: string, opts: unknown) => { calls.push([id, opts]); } },
    };
    await uninstall('b'.repeat(32));
    expect(calls).toEqual([['b'.repeat(32), { showConfirmDialog: true }]]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/management/management.test.ts`
Expected: FAIL — `getPermissionWarningsById`/`setEnabled`/`uninstall` are not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/management/management.ts`:

```ts
/** The browser's own human-readable permission warnings for an installed extension (C1). */
export const getPermissionWarningsById = (id: string): Promise<string[]> =>
  chrome.management.getPermissionWarningsById(id);

/** Enable or disable an installed extension. */
export const setEnabled = (id: string, enabled: boolean): Promise<void> =>
  chrome.management.setEnabled(id, enabled);

/** Uninstall via Chrome's native confirmation dialog (rejects if the user cancels). */
export const uninstall = (id: string): Promise<void> =>
  chrome.management.uninstall(id, { showConfirmDialog: true });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/management/management.test.ts`
Expected: PASS (3 original getExtensions tests + 3 new = 6).

- [ ] **Step 5: Commit**

```bash
git add src/management/management.ts src/management/management.test.ts
git commit -m "feat: management edge actions (getPermissionWarningsById, setEnabled, uninstall)

Co-Authored-By: Rafael Santos <rafael.santos@tessera.dev>"
```

---

## Task 4: View layer — tsconfig include, render, CSS, HTML shell

**Files:** Modify `tsconfig.json`; create `popup/render.ts`, `popup/popup.css`; replace `popup/index.html`

- [ ] **Step 1: Widen the tsconfig include**

In `tsconfig.json`, change `"include": ["src"]` to:

```json
  "include": ["src", "popup"]
```

- [ ] **Step 2: Create `popup/render.ts`**

```ts
// popup/render.ts — dumb data→DOM map (design spec §3.2). No logic beyond a
// static tier→label lookup; built with createElement/textContent so extension
// names and warnings are never interpreted as HTML. Verified in Phase 8.

import type { ReportView, ReportCard, ReportRow, Tier } from '../src/types';

const TIER_LABEL: Record<Tier, string> = {
  critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low',
};

const HONEST_LIMITS =
  'Ext-Ray flags what an extension can do, not proof it’s malicious — and can’t see its code or network activity.';

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderActions(enabled: boolean, canDisable: boolean): HTMLElement {
  const wrap = el('div', 'actions');
  if (!canDisable) {
    wrap.append(el('span', 'managed', 'managed by your organization'));
    return wrap;
  }
  const toggle = el('button', 'btn btn-disable', enabled ? 'Disable' : 'Enable');
  toggle.dataset.action = 'disable';
  const remove = el('button', 'btn btn-remove', 'Remove');
  remove.dataset.action = 'remove';
  wrap.append(toggle, remove);
  return wrap;
}

function renderCard(card: ReportCard): HTMLElement {
  const c = el('article', `card tier-${card.tier}`);
  c.dataset.ext = card.id;
  c.dataset.enabled = String(card.enabled);

  const head = el('div', 'card-head');
  head.append(el('span', 'dot'), el('span', 'tier-label', TIER_LABEL[card.tier]), el('span', 'name', card.name));
  c.append(head);

  for (const reason of card.reasons) c.append(el('p', 'reason', reason));

  const warning = el('p', 'warning js-warning');
  warning.dataset.id = card.id; // filled by the controller when the browser warning arrives
  c.append(warning);

  c.append(renderActions(card.enabled, card.canDisable));
  return c;
}

function renderRow(row: ReportRow): HTMLElement {
  const r = el('div', `row tier-${row.tier}`);
  r.dataset.ext = row.id;
  r.dataset.enabled = String(row.enabled);
  r.append(el('span', 'dot'), el('span', 'name', row.name));
  r.append(renderActions(row.enabled, row.canDisable));
  return r;
}

export function renderReport(view: ReportView, root: HTMLElement): void {
  root.className = 'report';
  root.replaceChildren();

  const header = el('header', 'header');
  header.append(el('div', `grade grade-${view.grade.grade.toLowerCase()}`, view.grade.grade));
  const meta = el('div', 'meta');
  meta.append(
    el('div', 'app-title', 'Ext-Ray'),
    el('div', 'summary',
      view.counts.total === 0
        ? 'No other extensions installed.'
        : `${view.counts.risky} need a look · ${view.counts.low} low-risk`),
  );
  header.append(meta);
  root.append(header);

  for (const card of view.risky) root.append(renderCard(card));

  if (view.low.length) {
    const section = el('section', 'low-section');
    section.append(el('h2', 'low-title', 'low-risk'));
    for (const row of view.low) section.append(renderRow(row));
    root.append(section);
  }

  root.append(el('footer', 'limits', HONEST_LIMITS));
}

export function renderError(root: HTMLElement, message: string): void {
  root.className = 'error';
  root.replaceChildren(el('p', 'error-msg', message));
}
```

- [ ] **Step 3: Create `popup/popup.css`**

```css
:root {
  --bg: #0f172a; --panel: #1e293b; --text: #e2e8f0; --muted: #94a3b8;
  --crit: #f87171; --high: #fb923c; --med: #facc15; --low: #64748b;
  color-scheme: dark;
}
* { box-sizing: border-box; }
body { margin: 0; width: 360px; font: 13px/1.45 system-ui, sans-serif; background: var(--bg); color: var(--text); }
#app { padding: 12px; }
#app.loading { color: var(--muted); }

.header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.grade { width: 44px; height: 44px; border-radius: 8px; display: grid; place-items: center;
  font-size: 24px; font-weight: 700; background: var(--panel); }
.grade-a { color: #4ade80; } .grade-b { color: #a3e635; } .grade-c { color: var(--med); }
.grade-d { color: var(--high); } .grade-f { color: var(--crit); }
.app-title { font-weight: 600; } .summary { color: var(--muted); font-size: 12px; }

.card { background: var(--panel); border-radius: 8px; padding: 10px; margin-bottom: 8px;
  border-left: 3px solid var(--low); }
.card.tier-critical { border-left-color: var(--crit); }
.card.tier-high { border-left-color: var(--high); }
.card.tier-medium { border-left-color: var(--med); }
.card-head { display: flex; align-items: center; gap: 6px; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--low); flex: none; }
.tier-critical .dot { background: var(--crit); }
.tier-high .dot { background: var(--high); }
.tier-medium .dot { background: var(--med); }
.tier-label { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
.name { font-weight: 600; }
.reason { margin: 6px 0 0; color: var(--text); }
.warning { margin: 6px 0 0; color: var(--muted); font-style: italic; }
.warning:empty { display: none; }

.actions { display: flex; gap: 8px; margin-top: 10px; }
.btn { font: inherit; padding: 4px 10px; border-radius: 6px; border: 1px solid #334155;
  background: #334155; color: var(--text); cursor: pointer; }
.btn-remove { background: transparent; }
.managed { color: var(--muted); font-size: 12px; }
.is-disabled { opacity: .55; }

.low-section { margin-top: 8px; }
.low-title { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted);
  margin: 8px 0 4px; }
.row { display: flex; align-items: center; gap: 8px; padding: 6px 4px; }
.row .name { font-weight: 400; flex: 1; }
.row .actions { margin-top: 0; }

.limits { margin-top: 12px; padding-top: 10px; border-top: 1px solid #334155;
  color: var(--muted); font-size: 11px; }
.error { padding: 16px; color: var(--crit); }
```

- [ ] **Step 4: Replace `popup/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Ext-Ray</title>
    <link rel="stylesheet" href="./popup.css" />
  </head>
  <body>
    <div id="app" class="loading">Scanning your extensions…</div>
    <script type="module" src="./index.ts"></script>
  </body>
</html>
```

(Note: write the literal ellipsis character `…` in the HTML, not the `…` escape.)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: OK. (`render.ts` is now type-checked via the widened `include`; `index.ts` is still the stub and compiles.)

- [ ] **Step 6: Commit**

```bash
git add tsconfig.json popup/render.ts popup/popup.css popup/index.html
git commit -m "feat: popup view layer (dumb render, CSS, shell) + typecheck popup/

Co-Authored-By: Rafael Santos <rafael.santos@tessera.dev>"
```

---

## Task 5: Controller — `popup/index.ts`

**Files:** Replace `popup/index.ts`

- [ ] **Step 1: Replace `popup/index.ts`**

```ts
// popup/index.ts — controller glue (design spec §3.3). Loads the fleet, builds
// the report, renders it, wires actions via event delegation, and progressively
// fills in the browser's permission warnings for risky cards. No unit tests
// (chrome.* + DOM glue) — exercised in Phase 8.

import { getExtensions, getPermissionWarningsById, setEnabled, uninstall } from '../src/management/management';
import { buildReport } from '../src/report/report';
import { renderReport, renderError } from './render';

const root = document.getElementById('app') as HTMLElement;

// One delegated listener survives re-renders (root itself is never replaced).
root.addEventListener('click', (e) => void onClick(e));

async function onClick(e: MouseEvent): Promise<void> {
  const btn = (e.target as HTMLElement).closest('button[data-action]') as HTMLButtonElement | null;
  if (!btn) return;
  const item = btn.closest('[data-ext]') as HTMLElement | null;
  if (!item) return;
  const id = item.dataset.ext ?? '';

  if (btn.dataset.action === 'disable') {
    const nextEnabled = item.dataset.enabled !== 'true'; // toggle
    await setEnabled(id, nextEnabled);
    item.dataset.enabled = String(nextEnabled);
    item.classList.toggle('is-disabled', !nextEnabled);
    btn.textContent = nextEnabled ? 'Disable' : 'Enable';
  } else if (btn.dataset.action === 'remove') {
    try {
      await uninstall(id); // Chrome's native confirm; rejects if the user cancels
      item.remove();
    } catch {
      /* user cancelled — leave the item in place */
    }
  }
}

async function fillWarnings(ids: string[]): Promise<void> {
  await Promise.all(ids.map(async (id) => {
    try {
      const warnings = await getPermissionWarningsById(id);
      if (warnings.length === 0) return;
      const slot = root.querySelector(`.js-warning[data-id="${id}"]`);
      if (slot) slot.textContent = warnings[0];
    } catch {
      /* leave the card without a warning line */
    }
  }));
}

async function load(): Promise<void> {
  const snapshots = await getExtensions().catch(() => null);
  if (snapshots === null) {
    renderError(root, 'Couldn’t read your extensions.');
    return;
  }
  const view = buildReport(snapshots);
  renderReport(view, root);
  void fillWarnings(view.risky.map((card) => card.id));
}

void load();
```

- [ ] **Step 2: Typecheck + existing tests green**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc OK; `Tests  72 passed (72)` (64 prior + 5 report + 3 management).

- [ ] **Step 3: Build the loadable extension**

Run: `npm run verify:build`
Expected: two-pass build succeeds and `check-dist: OK`. The popup now bundles `index.ts` → `report` + `management` + `render`. Confirm the popup chunk exists:
`ls dist/popup/index.html dist/assets/*.js`

- [ ] **Step 4: Commit**

```bash
git add popup/index.ts
git commit -m "feat: popup controller (load, render, delegated actions, progressive warnings)

Co-Authored-By: Rafael Santos <rafael.santos@tessera.dev>"
```

---

## Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: `Tests  72 passed (72)`; tsc OK.

- [ ] **Step 2: Loadable build**

Run: `npm run verify:build`
Expected: ends with `check-dist: OK`.

- [ ] **Step 3: Confirm the popup actually bundles the engines (not the stub)**

Run: `node -e "const fs=require('fs');const h=fs.readFileSync('dist/popup/index.html','utf8');console.log('links script:', /<script[^>]+assets\/[^>]+\.js/.test(h))"`
Expected: `links script: true` (the popup HTML references its bundled controller chunk).

---

## Self-review notes (spec coverage)

- §3.1 `buildReport` → Task 2 (pure, TDD). §3.2 dumb `render` → Task 4. §3.3 controller → Task 5. §3.4 `management` edge wrappers → Task 3.
- §4 types → Task 1 (`ReportCard`/`ReportRow`/`ReportView` match `buildReport`'s output and `render`'s input).
- §5 visual: grade header + tier dot/label/color + reasons + C1 warning slot + honest-limits footer → Task 4 (render + CSS). §6 actions: instant Disable toggle, `uninstall` native confirm + cancel handling, managed state → Task 5 controller + Task 4 `renderActions`. §7 states: empty (counts 0 summary), managed (`canDisable` false), error (`renderError`) → Tasks 4–5.
- §8 testing: `buildReport` + `management` wrappers TDD'd (Tasks 2–3); render/CSS/controller verified via build + Phase 8 → Tasks 4–6. §9 scope: no framework, no `notifications.onClicked` wiring, no settings, no re-score-on-disable — none appear.
- Type/path consistency: `ReportView`/`ReportCard`/`ReportRow` (types ↔ buildReport ↔ render), `data-ext`/`data-enabled`/`data-action`/`.js-warning[data-id]` (render emits ↔ controller reads), `{ showConfirmDialog: true }` (wrapper ↔ test), popup imports `../src/...` resolve under the widened tsconfig include.
