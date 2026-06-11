# Ext-Ray Phase 7 — Options / Settings UI Design

- **Date:** 2026-06-08
- **Status:** Approved design, pre-implementation
- **Elaborates:** main [design spec](2026-06-05-ext-ray-design.md) §5.6; [roadmap](../../ROADMAP.md) Phase 7 (clamp `scanIntervalMinutes ≥ 0.5`, widen tsconfig include for `options/`)

## 1. Summary

The options page lets the user configure the background guardian: toggle monitoring, choose the
re-scan cadence, toggle notifications, and pick which installed extensions to ignore. Settings
persist via the existing `storage/` layer and take effect **live** — a `chrome.storage.onChanged`
listener in the service worker reconciles the scan alarm whenever settings change. Vanilla TS + CSS,
no framework, consistent with the popup.

## 2. Decisions (from brainstorming, 2026-06-08)

1. **Ignore-list managed directly in options (Q1):** the page lists every installed extension with an
   "Ignore alerts" toggle; toggling adds/removes its id from the ignore list (`get/setIgnored`).
   Self-contained — no popup change needed; closes the loop where the guardian already *consumes*
   the ignore list but nothing previously *populated* it.
2. **Scan cadence is a preset dropdown (Q2):** fixed choices (1 / 5 / 15 / 30 / 60 minutes, default 5),
   so invalid input is impossible and Chrome's ≥0.5-min minimum is never hit.
3. **Auto-save on change:** each control writes to storage immediately; no Save button.
4. **Live alarm reconciliation:** the SW listens to `storage.onChanged` and reconciles the alarm, so
   changes take effect without a reload (monitoring-off actually stops scanning; cadence changes
   recreate the alarm).

## 3. Architecture

Pure core (tested) + dumb render + thin SW glue — the codebase's standard split.

### 3.1 `guardian/alarm.ts` — alarm reconciliation (pure, no I/O)

- **Purpose:** decide what to do to the scan alarm given the current settings and the existing alarm.
- **Interface:** `reconcileAlarm(settings: Settings, existing: { periodInMinutes?: number } | undefined): AlarmAction`,
  where `AlarmAction = { kind: 'none' } | { kind: 'clear' } | { kind: 'create'; periodInMinutes: number }`.
- **Logic:**
  - `!settings.monitoringEnabled` → `existing ? { kind: 'clear' } : { kind: 'none' }`.
  - else `period = Math.max(0.5, settings.scanIntervalMinutes)` (the Chrome-minimum safety net);
    `!existing || existing.periodInMinutes !== period` → `{ kind: 'create', periodInMinutes: period }`;
    else `{ kind: 'none' }`.
- **Deps:** none (`Settings` type only). The SW performs the chrome.alarms effect.

### 3.2 `background/index.ts` (modify)

- Replace the create-if-missing `ensureAlarm` with a reconcile step: read `getSettings()` +
  `chrome.alarms.get(ALARM_NAME)` → `reconcileAlarm(...)` → `applyAlarmAction(action)` (a thin helper:
  `clear` → `chrome.alarms.clear`; `create` → `chrome.alarms.create(ALARM_NAME, { periodInMinutes })`;
  `none` → nothing). Used on `runtime.onStartup` / `onInstalled` (alongside `migrate()` + the initial
  `scheduleScan()`).
- Add a top-level `chrome.storage.onChanged` listener: when `areaName === 'local'` and the `settings`
  key changed, run the same reconcile (get settings + existing alarm → `reconcileAlarm` → apply). This
  is what makes a settings change take effect live.
- `runScan`'s existing `if (!settings.monitoringEnabled) return;` guard stays as a belt-and-suspenders
  (the alarm is also cleared when monitoring is off).

### 3.3 `options/render.ts` — view (dumb)

- `renderOptions(settings: Settings, extensions: ExtSnapshot[], ignored: string[], root: HTMLElement): void`
  — maps state to DOM via `createElement`/`textContent` (XSS-safe). Emits: a monitoring checkbox
  (`data-setting="monitoring"`), a cadence `<select>` (`data-setting="cadence"`, options 1/5/15/30/60,
  current selected), a notify checkbox (`data-setting="notify"`), and one row per extension with an
  "Ignore alerts" checkbox (`data-ignore="<id>"`, checked if id ∈ ignored). No logic beyond mapping.

### 3.4 `options/index.ts` — controller (glue)

- On open → `getSettings()` + `getExtensions()` + `getIgnored()` → `renderOptions(...)`. Holds the current
  `settings` and `ignored` in closure vars. Delegated `change` listener on the root:
  - `data-setting="monitoring"` → `settings.monitoringEnabled = checkbox.checked`; `setSettings(settings)`.
  - `data-setting="cadence"` → `settings.scanIntervalMinutes = Number(select.value)`; `setSettings(settings)`.
  - `data-setting="notify"` → `settings.notify = checkbox.checked`; `setSettings(settings)`.
  - `data-ignore="<id>"` → add/remove id from `ignored`; `setIgnored(ignored)`.
- `getExtensions` failure → a graceful "Couldn't read your extensions" message (settings still render
  from `getSettings`).

### 3.5 `options/index.html` + `options/options.css`

Replace the stub HTML (root `#app`, link `options.css`, module `index.ts`). `options.css` reuses the
popup's dark-theme variables. Widen `tsconfig.json` `include` to `["src", "popup", "options"]`.

## 4. Types (addition to `src/types.ts`)

```ts
export type AlarmAction =
  | { kind: 'none' }
  | { kind: 'clear' }
  | { kind: 'create'; periodInMinutes: number };
```

## 5. Data flow

- **Load:** `getSettings()` + `getExtensions()` + `getIgnored()` → `renderOptions`.
- **On control change (auto-save):** update the relevant store (`setSettings` or `setIgnored`).
- **SW reconcile:** `storage.onChanged(local, settings)` → `getSettings()` + `alarms.get` →
  `reconcileAlarm` → `applyAlarmAction`. Same reconcile runs on SW startup.

## 6. Testing (TDD)

- **Pure `reconcileAlarm` is the target:** monitoring-off + alarm exists → `clear`; off + none → `none`;
  on + missing → `create(period)`; on + period differs → `create(newPeriod)`; on + period matches →
  `none`; `scanIntervalMinutes` below 0.5 → period clamped to 0.5 in the `create`.
- **Options render + controller + the SW `storage.onChanged`/reconcile wiring are glue** → verified by
  build + **Phase 8** (Playwright). Existing tests stay green; the SW change must not break the suite
  or `tsc`.

## 7. Scope / non-goals (YAGNI)

- Only the 3 `Settings` fields + ignore management + live alarm reconcile.
- No import/export of settings, no per-extension notification rules, no theme/appearance options.
- No popup change (ignoring is managed here, per Q1).
- The research candidates N1–N4 (peer-group analysis, etc.) stay logged in the roadmap, out of this phase.
