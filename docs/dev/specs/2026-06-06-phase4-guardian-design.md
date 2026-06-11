# Ext-Ray Phase 4 — Background Guardian Design

- **Date:** 2026-06-06
- **Status:** Approved design, pre-implementation
- **Elaborates:** main [design spec](2026-06-05-ext-ray-design.md) §5.4, §6, §8; [roadmap](../../ROADMAP.md) Phase 4 (incl. adopted C1/C2 and research corrections)

## 1. Summary

The background guardian is the service worker that turns Ext-Ray's two pure engines plus
its storage layer into a live, continuous monitor. On an `onInstalled`/state-change event or
an alarm tick it re-scans the installed extensions, diffs them against the last snapshot,
classifies the severity of any changes, and raises **one batched OS notification** when
something noteworthy happens — then persists the new baseline. All decision logic is pure and
unit-tested; the `chrome.*` surface stays at the edges.

## 2. Decisions (from brainstorming, 2026-06-06)

1. **Notification policy: severity-gated + batched.** Notify only when ≥1 change clears a
   severity bar; batch a scan's noteworthy changes into a single notification that opens the
   popup. Stay silent on low-severity churn. (Aligns with the research's "don't over-flag"
   correction — declared signals over-predict malice ~10×.)
2. **"Version bump after long stability" = 60 days**, kept as a tunable code constant
   (`STABILITY_WINDOW_DAYS`), not user-facing until Phase 7 options.
3. **C1 scope:** Phase 4 introduces a thin `chrome.management` edge exposing `getExtensions()`
   (`getAll()` only). `getPermissionWarningsById` display is deferred to the Phase 6 popup,
   where per-extension warnings are most legible.

## 3. Architecture (pure core, thin glue)

Three units, each with one purpose:

### 3.1 `management/` — chrome.management edge (thin glue)

- **Purpose:** isolate `chrome.management` I/O behind a typed function.
- **Interface:** `getExtensions(): Promise<ExtSnapshot[]>` — `chrome.management.getAll()` →
  filter `type === 'extension'`, exclude self (`chrome.runtime.id`) → normalize each
  `ExtensionInfo` to the `ExtSnapshot` projection (spec §7).
- **Deps:** `chrome.management`, `chrome.runtime`.
- (Phase 6 extends this module with `getPermissionWarningsById`.)

### 3.2 `guardian/` — scan evaluation engine (pure, no I/O)

- **Purpose:** decide what changed, how serious it is, what to persist, and whether/what to
  notify — deterministically, from data alone.
- **Entry point:** `evaluateScan(input: ScanInput): ScanResult`.
- **Helpers (each unit-tested):**
  - `classifySeverity(change, ctx): Severity`
  - `nextTimestamps(prevTimestamps, curr, diffChanges, now): Record<string, ExtTimestamps>`
  - `buildNotification(noteworthy): { title: string; message: string } | null`
- **Deps:** `scoring/` (`scoreExtension`), `snapshot/` (`diff`), shared types. No `chrome.*`.

### 3.3 `background/` — service worker (thin glue)

- **Purpose:** wiring + effects only.
- **Behavior:**
  - Register listeners **synchronously at the top level**: `chrome.management.onInstalled`,
    `onEnabled`, `onDisabled`, `onUninstalled`; `chrome.alarms.onAlarm`;
    `chrome.runtime.onStartup` / `onInstalled`.
  - On startup: `migrate()`; ensure the self-healing alarm exists (`chrome.alarms.get` →
    create from `settings.scanIntervalMinutes` if missing).
  - Each registered event and each alarm tick **triggers one scan run** (the event payload is
    only a trigger — the snapshot diff is the source of truth, since `onInstalled` carries no
    install-vs-update flag, spec §4.4).
  - **Scan orchestration:** `getExtensions()` → load prev snapshot + timestamps + settings +
    ignore list → `evaluateScan(...)` → if `result.notification` and `settings.notify`, fire
    `chrome.notifications.create` → persist `curr` snapshot + `result.timestamps`.
- **Deps:** `management/`, `guardian/`, `storage/`, `chrome.alarms`, `chrome.notifications`,
  `chrome.runtime`.

## 4. Types (additions to `src/types.ts`)

```ts
export type Severity = 'info' | 'notable' | 'high';
export interface ClassifiedChange { change: Change; severity: Severity; }

export interface ScanInput {
  prev: ExtSnapshot[];
  curr: ExtSnapshot[];
  timestamps: Record<string, ExtTimestamps>;
  settings: Settings;
  ignored: string[];
  now: number; // epoch ms — injected, never read from a clock inside the pure core
}

export interface ScanResult {
  timestamps: Record<string, ExtTimestamps>;        // new map to persist
  classified: ClassifiedChange[];                    // all changes + severity (for trace)
  notification: { title: string; message: string } | null; // batched; null = stay silent
}
```

## 5. Severity model

`noteworthy = severity ∈ {notable, high}`. Changes for ignored ids are dropped before
classification. Severity per change kind:

| Change | Severity | Rationale |
|---|---|---|
| `permissions-added` incl. a host-pattern (`<all_urls>`, `*://*/*`, any `…://…/…`) | **high** | host/match-pattern expansion is the confirmed high-confidence Chrome re-approval signal |
| `permissions-added` (API permissions only) | notable | real, but not reliably a Chrome warning — flag at lower confidence |
| `publisher-changed` (`updateUrl`) | **high** | possible ownership/publisher change (§4.5) |
| `version-changed`, prior `lastVersionChange` ≥ `STABILITY_WINDOW_DAYS` ago | notable | "suspicious update after long stability" |
| `version-changed`, routine | info | routine update — silent |
| `installed`, `installType` ∈ {development, sideload} | **high** | unexpected install vector |
| `installed`, normal, `scoreExtension` tier ∈ {critical, high} | notable | worth a heads-up |
| `installed`, normal, tier ∈ {medium, low} | info | user just installed a benign extension — silent |
| `permissions-removed`, `removed` | info | capability decreased / gone — not a risk increase |

`classifySeverity` consumes a context with: the current `ExtSnapshot` (for `installType` +
`scoreExtension`) and the **pre-update** `lastVersionChange` timestamp (for the stability test).

## 6. Data flow & invariants

Per scan: `getExtensions()` → load prev/timestamps/settings/ignored → `diff(prev, curr)` →
`evaluateScan` (classify using **old** timestamps; drop ignored; compute **new** timestamps;
build batched notification from noteworthy changes) → SW fires notification (if any and
`settings.notify`) → persist `curr` + new timestamps.

**Invariants:**
- **First-run / baseline:** if `prev` is empty, `evaluateScan` returns `notification: null`
  and only establishes timestamps (all `firstSeen = now`). No notification storm on install.
  Extends the snapshot engine's §8 first-run rule to the guardian.
- **Notify-once / natural dedup:** the snapshot is persisted after every scan, so each change
  is detected — and notified — exactly once.
- **Scan serialization:** an event and an alarm tick can fire near-simultaneously. Scans are
  serialized in the SW (an in-flight scan completes before the next begins) so two runs can't
  read the same prev snapshot and race the persist — which would double-notify or lose an
  update. This guard lives in the SW glue; the pure core stays stateless.
- **Stability boundary:** the stability test reads `lastVersionChange` *before* `nextTimestamps`
  overwrites it. Determinism: `now` is injected into the pure core, never read from a clock.
- **Timestamp lifecycle:** new id → `{ firstSeen: now, lastVersionChange: now }`; version
  changed → `lastVersionChange = now`; removed id → dropped from the map (re-install is
  legitimately "new").

## 7. Error handling (boundaries only — spec §8)

- `getExtensions()` unavailable/empty → empty array → guardian no-ops gracefully.
- Self exclusion via `chrome.runtime.id`; themes/apps filtered (`type !== 'extension'`).
- Alarm may be cleared on browser restart → self-heal on startup (`alarms.get` → recreate).
- The pure core trusts its inputs (internal invariant); validation lives at the `chrome.*` edge.

## 8. Instrumentation

- `sec.guardian` trace (already used by `snapshot/`): scan decision — counts of changes by
  severity, whether a notification fired (decision + shape, never payload contents).
- `perf.guardian` trace: scan wall-clock + extension count.

## 9. Testing (TDD)

Pure `guardian/` core is the test target:
- `classifySeverity`: one fixture per row of §5 (host-expansion → high; API-perm add → notable;
  updateUrl → high; stable-then-bumped → notable; routine bump → info; sideloaded install →
  high; normal critical install → notable; normal low install → info; removed/perms-removed → info).
- Stability rule: bump at exactly/over/under 60 days (boundary).
- `evaluateScan`: first-run suppression (empty prev → null notification); ignore-list
  suppression; batched notification across multiple noteworthy changes; `settings.notify=false`
  path; timestamp lifecycle (new/changed/removed).
- `management/` + the SW wiring are thin glue: a light `getExtensions` test with the in-memory
  chrome fake (filter + self-exclude + normalize); full wiring is integration-tested in Phase 8.

## 10. Scope / non-goals (YAGNI)

- No C1 warning **display** (Phase 6); no `scanIntervalMinutes` UI (Phase 7).
- No severity **persistence** — the guardian computes and acts; the popup re-derives risk.
- `scoreExtension` reused as-is; endorsed weights untouched.
- No notification click-routing beyond "open the popup" (default action).
- Deferred §13.2 ideas (composite flag, identity-churn, etc.) remain out of this phase.
