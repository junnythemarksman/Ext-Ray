# Phase 7 — Options / Settings UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A settings page to configure the guardian — toggle monitoring, choose re-scan cadence, toggle notifications, and pick which installed extensions to ignore — with changes taking effect live via a service-worker alarm reconcile.

**Architecture:** A pure `reconcileAlarm(settings, existing) → AlarmAction` (the only real logic, TDD'd) drives the service worker's alarm; the SW reconciles on startup and on `chrome.storage.onChanged`. A dumb `options/render.ts` maps state→DOM and an `options/index.ts` controller auto-saves each change to the existing `storage/` layer. Vanilla TS+CSS, no framework. Spec: `docs/superpowers/specs/2026-06-08-phase7-options-design.md`.

**Tech Stack:** TypeScript, Vite, Vitest. Reuses `storage/`, `management/`, the guardian SW.

---

## File structure

| File | Responsibility |
|---|---|
| `src/types.ts` (modify) | `AlarmAction` union |
| `src/guardian/alarm.ts` (create) + `.test.ts` | Pure `reconcileAlarm` — the TDD target |
| `src/background/index.ts` (modify) | Use `reconcileAlarm` (replace `ensureAlarm`) + `storage.onChanged` live reconcile |
| `tsconfig.json` (modify) | Add `options` to `include` |
| `options/render.ts` (create) | Dumb `renderOptions` (settings + ignore list → DOM) |
| `options/options.css` (create) | Styling (reuses the popup's dark theme) |
| `options/index.html` (replace stub) | Shell |
| `options/index.ts` (replace stub) | Controller: load → render → auto-save changes |

`reconcileAlarm` is the only unit-tested unit (spec §6). The SW wiring, render, and controller are glue → verified by `tsc` + `verify:build` + Phase 8. Test count goes 74 → 80.

---

## Task 1: Add the `AlarmAction` type

**Files:** Modify `src/types.ts` (append at end)

- [ ] **Step 1: Append the type**

```ts
// ── Phase 7: options / alarm reconciliation ───────────────────────────────────

export type AlarmAction =
  | { kind: 'none' }
  | { kind: 'clear' }
  | { kind: 'create'; periodInMinutes: number };
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: OK.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add AlarmAction type for Phase 7 alarm reconciliation

Co-Authored-By: Rafael Santos <rafael.santos@tessera.dev>"
```

---

## Task 2: `guardian/alarm.ts` — `reconcileAlarm` (pure)

**Files:** Create `src/guardian/alarm.test.ts`, `src/guardian/alarm.ts`

- [ ] **Step 1: Write the failing test**

Create `src/guardian/alarm.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Settings } from '../types';
import { reconcileAlarm } from './alarm';

const settings = (o: Partial<Settings> = {}): Settings => ({
  monitoringEnabled: true, scanIntervalMinutes: 5, notify: true, ...o,
});

describe('reconcileAlarm', () => {
  it('clears the alarm when monitoring is off and one exists', () => {
    expect(reconcileAlarm(settings({ monitoringEnabled: false }), { periodInMinutes: 5 })).toEqual({ kind: 'clear' });
  });

  it('does nothing when monitoring is off and no alarm exists', () => {
    expect(reconcileAlarm(settings({ monitoringEnabled: false }), undefined)).toEqual({ kind: 'none' });
  });

  it('creates the alarm when monitoring is on and none exists', () => {
    expect(reconcileAlarm(settings({ scanIntervalMinutes: 5 }), undefined)).toEqual({ kind: 'create', periodInMinutes: 5 });
  });

  it('recreates the alarm when the period no longer matches', () => {
    expect(reconcileAlarm(settings({ scanIntervalMinutes: 15 }), { periodInMinutes: 5 })).toEqual({ kind: 'create', periodInMinutes: 15 });
  });

  it('does nothing when monitoring is on and the period already matches', () => {
    expect(reconcileAlarm(settings({ scanIntervalMinutes: 5 }), { periodInMinutes: 5 })).toEqual({ kind: 'none' });
  });

  it('clamps the period to Chrome’s 0.5-minute minimum', () => {
    expect(reconcileAlarm(settings({ scanIntervalMinutes: 0.1 }), undefined)).toEqual({ kind: 'create', periodInMinutes: 0.5 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/guardian/alarm.test.ts`
Expected: FAIL — `Cannot find module './alarm'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/guardian/alarm.ts`:

```ts
// guardian/alarm.ts — pure alarm-reconciliation decision (design spec §3.1). No I/O.
// Given the current settings and the existing scan alarm (if any), decide whether to
// leave it, clear it, or (re)create it. The service worker performs the chrome.alarms
// effect; this function just decides. Clamps to Chrome's 0.5-minute minimum period.

import type { Settings, AlarmAction } from '../types';

const MIN_PERIOD_MINUTES = 0.5; // Chrome 120+ will not honor a shorter alarm period

export function reconcileAlarm(
  settings: Settings,
  existing: { periodInMinutes?: number } | undefined,
): AlarmAction {
  if (!settings.monitoringEnabled) {
    return existing ? { kind: 'clear' } : { kind: 'none' };
  }
  const periodInMinutes = Math.max(MIN_PERIOD_MINUTES, settings.scanIntervalMinutes);
  if (!existing || existing.periodInMinutes !== periodInMinutes) {
    return { kind: 'create', periodInMinutes };
  }
  return { kind: 'none' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/guardian/alarm.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/guardian/alarm.ts src/guardian/alarm.test.ts
git commit -m "feat: pure reconcileAlarm (monitoring/cadence -> alarm action, 0.5min clamp)

Co-Authored-By: Rafael Santos <rafael.santos@tessera.dev>"
```

---

## Task 3: Wire the reconcile into the service worker

**Files:** Modify `src/background/index.ts` (replace the whole file)

This replaces Phase 4's create-if-missing `ensureAlarm` with a reconcile, and adds a `storage.onChanged` listener so settings changes take effect live. No unit test (chrome.* glue, per spec §6 — verified by `tsc` + build + Phase 8). The only logic change is delegated to the already-tested `reconcileAlarm`.

- [ ] **Step 1: Replace `src/background/index.ts` with**

```ts
// background/ — the MV3 service worker (design spec §3.3, Phase 7 §3.2). Thin glue:
// wiring + I/O. All decisions live in the pure guardian core (evaluateScan, reconcileAlarm).
// Date.now() lives here (the edge), never in the pure core. Integration-tested in Phase 8.

import { getExtensions } from '../management/management';
import { evaluateScan } from '../guardian/guardian';
import { reconcileAlarm } from '../guardian/alarm';
import { getSnapshot, setSnapshot, getTimestamps, setTimestamps, getSettings, getIgnored, migrate } from '../storage/storage';
import { trace } from '../debug';
import type { AlarmAction } from '../types';

const ALARM_NAME = 'extray-scan';
const tPerf = trace('perf.guardian');

// Serialize scans: an in-flight scan finishes before the next starts (spec §6).
let inFlight: Promise<void> = Promise.resolve();
function scheduleScan(): Promise<void> {
  inFlight = inFlight.catch(() => undefined).then(runScan);
  return inFlight;
}

async function runScan(): Promise<void> {
  const start = Date.now();
  const [curr, prev, timestamps, settings, ignored] = await Promise.all([
    getExtensions(), getSnapshot(), getTimestamps(), getSettings(), getIgnored(),
  ]);
  if (!settings.monitoringEnabled) return;

  const result = evaluateScan({ prev, curr, timestamps, settings, ignored, now: Date.now() });
  if (result.notification) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title: result.notification.title,
      message: result.notification.message,
    });
  }
  await Promise.all([setSnapshot(curr), setTimestamps(result.timestamps)]);
  if (tPerf.enabled) tPerf('scan complete', { ms: Date.now() - start, count: curr.length });
}

async function applyAlarmAction(action: AlarmAction): Promise<void> {
  if (action.kind === 'clear') await chrome.alarms.clear(ALARM_NAME);
  else if (action.kind === 'create') chrome.alarms.create(ALARM_NAME, { periodInMinutes: action.periodInMinutes });
}

// Bring the scan alarm in line with the current settings (create / clear / leave).
async function reconcileAlarmNow(): Promise<void> {
  const [settings, existing] = await Promise.all([getSettings(), chrome.alarms.get(ALARM_NAME)]);
  await applyAlarmAction(reconcileAlarm(settings, existing));
}

async function init(): Promise<void> {
  await migrate();
  await reconcileAlarmNow();
  await scheduleScan();
}

// Listeners registered synchronously at top level (MV3 requirement, spec §4.4).
chrome.runtime.onStartup.addListener(() => void init());
chrome.runtime.onInstalled.addListener(() => void init());
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === ALARM_NAME) void scheduleScan(); });
chrome.management.onInstalled.addListener(() => void scheduleScan());
chrome.management.onEnabled.addListener(() => void scheduleScan());
chrome.management.onDisabled.addListener(() => void scheduleScan());
chrome.management.onUninstalled.addListener(() => void scheduleScan());
// Settings changed (from the options page) → re-reconcile the alarm so it takes effect live.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.settings) void reconcileAlarmNow();
});
```

- [ ] **Step 2: Typecheck + tests still green**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc OK; `Tests  80 passed (80)` (74 prior + 6 reconcileAlarm).

- [ ] **Step 3: Build still succeeds (self-contained SW)**

Run: `npm run verify:build`
Expected: `check-dist: OK`. Confirm the SW is still self-contained:
`node -e "const s=require('fs').readFileSync('dist/background/index.js','utf8');console.log('self-contained:', !/\bfrom\s*['\"]/.test(s))"` → `self-contained: true`.

- [ ] **Step 4: Commit**

```bash
git add src/background/index.ts
git commit -m "feat: SW reconciles the scan alarm on startup + settings change

Co-Authored-By: Rafael Santos <rafael.santos@tessera.dev>"
```

---

## Task 4: Options view layer — tsconfig, render, CSS, HTML

**Files:** Modify `tsconfig.json`; create `options/render.ts`, `options/options.css`; replace `options/index.html`

- [ ] **Step 1: Widen the tsconfig include**

In `tsconfig.json`, change `"include": ["src", "popup"]` to:

```json
  "include": ["src", "popup", "options"]
```

- [ ] **Step 2: Create `options/render.ts`**

```ts
// options/render.ts — dumb data→DOM map (design spec §3.3). No logic beyond mapping;
// built with createElement so extension names are never interpreted as HTML. Phase 8 tested.

import type { Settings, ExtSnapshot } from '../src/types';

const CADENCE_PRESETS = [1, 5, 15, 30, 60];

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function checkbox(checked: boolean): HTMLInputElement {
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = checked;
  return box;
}

function settingRow(setting: 'monitoring' | 'notify', label: string, checked: boolean): HTMLElement {
  const row = el('label', 'row');
  const box = checkbox(checked);
  box.dataset.setting = setting;
  row.append(box, el('span', 'label', label));
  return row;
}

function cadenceRow(current: number): HTMLElement {
  const row = el('label', 'row');
  row.append(el('span', 'label', 'Re-scan every'));
  const select = document.createElement('select');
  select.className = 'cadence';
  select.dataset.setting = 'cadence';
  for (const min of CADENCE_PRESETS) {
    const opt = document.createElement('option');
    opt.value = String(min);
    opt.textContent = min === 1 ? '1 minute' : `${min} minutes`;
    if (min === current) opt.selected = true;
    select.append(opt);
  }
  row.append(select);
  return row;
}

function ignoreRow(ext: ExtSnapshot, ignored: boolean): HTMLElement {
  const row = el('label', 'row');
  const box = checkbox(ignored);
  box.dataset.ignore = ext.id;
  row.append(box, el('span', 'label', ext.name));
  return row;
}

export function renderOptions(
  settings: Settings,
  extensions: ExtSnapshot[] | null, // null = couldn't read the extension list
  ignored: string[],
  root: HTMLElement,
): void {
  const ignoredSet = new Set(ignored);
  root.className = 'options';
  root.replaceChildren();

  root.append(el('h1', 'title', 'Ext-Ray — Settings'));
  root.append(settingRow('monitoring', 'Watch for changes in the background', settings.monitoringEnabled));
  root.append(cadenceRow(settings.scanIntervalMinutes));
  root.append(settingRow('notify', 'Notify me when something changes', settings.notify));

  const section = el('section', 'ignore-section');
  section.append(el('h2', 'section-title', 'Ignore alerts from'));
  if (extensions === null) {
    section.append(el('p', 'note', 'Couldn’t read your extensions.'));
  } else if (extensions.length === 0) {
    section.append(el('p', 'note', 'No other extensions installed.'));
  } else {
    for (const ext of extensions) section.append(ignoreRow(ext, ignoredSet.has(ext.id)));
  }
  root.append(section);
}
```

- [ ] **Step 3: Create `options/options.css`**

```css
:root {
  --bg: #0f172a; --panel: #1e293b; --text: #e2e8f0; --muted: #94a3b8; --line: #334155;
  color-scheme: dark;
}
* { box-sizing: border-box; }
body { margin: 0; width: 420px; font: 14px/1.5 system-ui, sans-serif; background: var(--bg); color: var(--text); }
#app { padding: 16px; }
.title { font-size: 18px; margin: 0 0 14px; }
.row { display: flex; align-items: center; gap: 10px; padding: 8px 0; cursor: pointer; }
.row .label { flex: 1; }
.cadence { font: inherit; background: var(--panel); color: var(--text); border: 1px solid var(--line);
  border-radius: 6px; padding: 4px 8px; }
.ignore-section { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--line); }
.section-title { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 0 0 6px; }
.note { color: var(--muted); }
.error { padding: 16px; color: #f87171; }
```

- [ ] **Step 4: Replace `options/index.html`** (write the literal ellipsis `…`)

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Ext-Ray Settings</title>
    <link rel="stylesheet" href="./options.css" />
  </head>
  <body>
    <div id="app">Loading settings…</div>
    <script type="module" src="./index.ts"></script>
  </body>
</html>
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: OK (`options/render.ts` now type-checked via the widened include; the stub `options/index.ts` still compiles).

- [ ] **Step 6: Commit**

```bash
git add tsconfig.json options/render.ts options/options.css options/index.html
git commit -m "feat: options view layer (dumb render, CSS, shell) + typecheck options/

Co-Authored-By: Rafael Santos <rafael.santos@tessera.dev>"
```

---

## Task 5: Options controller — `options/index.ts`

**Files:** Replace `options/index.ts`

- [ ] **Step 1: Replace `options/index.ts` with**

```ts
// options/index.ts — controller glue (design spec §3.4). Loads settings + the
// installed-extension list + ignore list, renders the form, and auto-saves each
// change to storage. No unit tests (chrome.* + DOM glue) — exercised in Phase 8.

import { getExtensions } from '../src/management/management';
import { getSettings, setSettings, getIgnored, setIgnored } from '../src/storage/storage';
import { renderOptions } from './render';
import type { Settings, ExtSnapshot } from '../src/types';

const root = document.getElementById('app') as HTMLElement;

let settings: Settings;
let ignored: string[];

root.addEventListener('change', (e) => void onChange(e));

async function onChange(e: Event): Promise<void> {
  const target = e.target as HTMLInputElement & HTMLSelectElement;
  const setting = target.dataset.setting;
  const ignoreId = target.dataset.ignore;

  if (setting === 'monitoring') {
    settings = { ...settings, monitoringEnabled: target.checked };
    await setSettings(settings);
  } else if (setting === 'notify') {
    settings = { ...settings, notify: target.checked };
    await setSettings(settings);
  } else if (setting === 'cadence') {
    settings = { ...settings, scanIntervalMinutes: Number(target.value) };
    await setSettings(settings);
  } else if (ignoreId) {
    ignored = target.checked
      ? [...new Set([...ignored, ignoreId])]
      : ignored.filter((id) => id !== ignoreId);
    await setIgnored(ignored);
  }
}

async function load(): Promise<void> {
  settings = await getSettings();
  ignored = await getIgnored();
  const extensions: ExtSnapshot[] | null = await getExtensions().catch(() => null);
  renderOptions(settings, extensions, ignored, root);
}

void load();
```

- [ ] **Step 2: Typecheck + tests green**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc OK; `Tests  80 passed (80)`.

- [ ] **Step 3: Build the loadable extension**

Run: `npm run verify:build`
Expected: `check-dist: OK`. Confirm the options page bundles its controller (not the stub):
`node -e "const fs=require('fs');const d='dist/assets';const js=fs.readdirSync(d).filter(f=>f.startsWith('options')&&f.endsWith('.js')).map(f=>fs.readFileSync(d+'/'+f,'utf8')).join('');console.log('real controller:', js.includes('Ext-Ray — Settings'), '| stub gone:', !js.includes('coming soon'))"`
Expected: `real controller: true | stub gone: true`.

- [ ] **Step 4: Commit**

```bash
git add options/index.ts
git commit -m "feat: options controller (load, render, auto-save settings + ignore list)

Co-Authored-By: Rafael Santos <rafael.santos@tessera.dev>"
```

---

## Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: `Tests  80 passed (80)`; tsc OK.

- [ ] **Step 2: Loadable build**

Run: `npm run verify:build`
Expected: ends `check-dist: OK`.

- [ ] **Step 3: Confirm the options page links its bundled script + CSS**

Run: `node -e "const h=require('fs').readFileSync('dist/options/index.html','utf8');console.log('script:', /<script[^>]+assets\/[^>]+\.js/.test(h), '| css:', /assets\/[^>]+\.css/.test(h))"`
Expected: `script: true | css: true`.

---

## Self-review notes (spec coverage)

- §3.1 `reconcileAlarm` → Task 2 (pure, TDD). §3.2 SW reconcile + `storage.onChanged` → Task 3. §3.3 dumb `renderOptions` → Task 4. §3.4 controller → Task 5. §3.5 HTML/CSS/tsconfig → Task 4.
- §4 `AlarmAction` type → Task 1 (matches `reconcileAlarm`'s return + the SW's `applyAlarmAction`).
- §2 decisions: ignore-via-options (Task 4 `ignoreRow` + Task 5 `data-ignore` handler); preset cadence dropdown (Task 4 `cadenceRow`, 1/5/15/30/60); auto-save (Task 5 writes on each `change`); live reconcile (Task 3 `storage.onChanged`).
- §5 data flow + §6 testing boundary (reconcileAlarm TDD'd; render/controller/SW glue → Phase 8) honored. §7 scope: no import/export, no per-extension notification rules, no theme, no popup change — none appear.
- Type/path consistency: `AlarmAction` (types ↔ alarm.ts ↔ background applyAlarmAction); `data-setting`(monitoring/notify/cadence) + `data-ignore` (render emits ↔ controller reads); options imports `../src/...` resolve under the widened include; `setSettings`/`setIgnored`/`getSettings`/`getIgnored` (storage) + `getExtensions` (management) signatures match call sites; `changes.settings` matches the storage key `'settings'`.
