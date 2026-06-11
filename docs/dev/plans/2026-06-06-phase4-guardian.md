# Phase 4 — Background Guardian Implementation Plan

> Implement task-by-task; steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the background guardian that turns Ext-Ray's pure engines + storage into a live monitor: on events/alarm it re-scans installed extensions, classifies the severity of changes, and raises one batched notification when something is noteworthy.

**Architecture:** Approach A — a pure, unit-tested `guardian/` core (`evaluateScan` + `classifySeverity`) wrapped by a thin `chrome.*` service-worker. A thin `management/` edge supplies `getExtensions()`. All decision logic is pure (no I/O); the service worker is glue. See spec `docs/dev/specs/2026-06-06-phase4-guardian-design.md`.

**Tech Stack:** TypeScript (ESM), Vitest, `@types/chrome`. Reuses `scoring/`, `snapshot/`, `storage/`, `debug/`.

---

## File structure

| File | Responsibility |
|---|---|
| `src/types.ts` (modify) | Add `Severity`, `ClassifiedChange`, `ScanInput`, `ScanResult` |
| `src/management/management.ts` (create) | `chrome.management` edge: `getExtensions()` |
| `src/management/management.test.ts` (create) | Filter/self-exclude/normalize, with in-memory chrome fake |
| `src/guardian/guardian.ts` (create) | Pure core: `evaluateScan`, `classifySeverity`, helpers |
| `src/guardian/guardian.test.ts` (create) | Severity table + scan-evaluation behavior (TDD target) |
| `src/background/index.ts` (create) | Service-worker glue: listeners, self-healing alarm, serialized scans |

---

## Task 1: Add Phase 4 shared types

**Files:**
- Modify: `src/types.ts` (append after the `ExtTimestamps` interface)

Types are declarations (no behavior), so there is no test step — they're consumed by Task 2–4 tests, which fail to compile without them.

- [ ] **Step 1: Append the types**

Add to the end of `src/types.ts`:

```ts
// ── Phase 4: background guardian ──────────────────────────────────────────────

export type Severity = 'info' | 'notable' | 'high';

export interface ClassifiedChange {
  change: Change;
  severity: Severity;
}

// Everything the pure guardian core needs to evaluate one scan. `now` is injected
// (never read from a clock inside the pure core) so the core stays deterministic.
export interface ScanInput {
  prev: ExtSnapshot[];
  curr: ExtSnapshot[];
  timestamps: Record<string, ExtTimestamps>;
  settings: Settings;
  ignored: string[];
  now: number;
}

export interface ScanResult {
  timestamps: Record<string, ExtTimestamps>;        // new map to persist
  classified: ClassifiedChange[];                    // all (non-ignored) changes + severity
  notification: { title: string; message: string } | null; // batched; null = stay silent
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: OK (no errors) — the new types are self-contained.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add Phase 4 guardian types (Severity, ScanInput, ScanResult)"
```

---

## Task 2: `management/` edge — `getExtensions()`

**Files:**
- Create: `src/management/management.test.ts`
- Create: `src/management/management.ts`

- [ ] **Step 1: Write the failing test**

Create `src/management/management.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { getExtensions } from './management';

const SELF_ID = 's'.repeat(32);

function installFakeChrome(all: unknown[], selfId = SELF_ID): void {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { id: selfId },
    management: { getAll: async () => all },
  };
}

const info = (o: Record<string, unknown>) => ({
  id: 'a'.repeat(32), name: 'X', version: '1.0.0', enabled: true, type: 'extension',
  installType: 'normal', permissions: ['storage'], hostPermissions: [], mayDisable: true, ...o,
});

beforeEach(() => installFakeChrome([]));

describe('getExtensions', () => {
  it('excludes Ext-Ray itself', async () => {
    installFakeChrome([info({ id: SELF_ID }), info({ id: 'b'.repeat(32) })]);
    const ids = (await getExtensions()).map((e) => e.id);
    expect(ids).toEqual(['b'.repeat(32)]);
  });

  it('filters out non-extensions (themes/apps)', async () => {
    installFakeChrome([info({ id: 'a'.repeat(32), type: 'theme' }), info({ id: 'b'.repeat(32) })]);
    const ids = (await getExtensions()).map((e) => e.id);
    expect(ids).toEqual(['b'.repeat(32)]);
  });

  it('normalizes to the ExtSnapshot projection, defaulting permission arrays', async () => {
    installFakeChrome([info({ id: 'b'.repeat(32), permissions: undefined, hostPermissions: undefined })]);
    const [snap] = await getExtensions();
    expect(snap).toEqual({
      id: 'b'.repeat(32), name: 'X', version: '1.0.0', enabled: true, type: 'extension',
      installType: 'normal', permissions: [], hostPermissions: [], mayDisable: true, updateUrl: undefined,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/management/management.test.ts`
Expected: FAIL — `Cannot find module './management'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/management/management.ts`:

```ts
// management/ — the chrome.management edge (thin glue, design spec §3.1).
// The only chrome.management call this phase. Phase 6 extends it with
// getPermissionWarningsById for the popup.

import type { ExtSnapshot } from '../types';

function normalize(e: chrome.management.ExtensionInfo): ExtSnapshot {
  return {
    id: e.id,
    name: e.name,
    version: e.version,
    enabled: e.enabled,
    type: e.type,
    installType: e.installType,
    permissions: e.permissions ?? [],
    hostPermissions: e.hostPermissions ?? [],
    mayDisable: e.mayDisable,
    updateUrl: e.updateUrl,
  };
}

/** Installed extensions (excluding themes/apps and Ext-Ray itself), normalized. */
export async function getExtensions(): Promise<ExtSnapshot[]> {
  const all = await chrome.management.getAll();
  const selfId = chrome.runtime.id;
  return all.filter((e) => e.type === 'extension' && e.id !== selfId).map(normalize);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/management/management.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/management/management.ts src/management/management.test.ts
git commit -m "feat: add chrome.management edge (getExtensions)"
```

---

## Task 3: `guardian/` — `classifySeverity` + the severity table

**Files:**
- Create: `src/guardian/guardian.test.ts`
- Create: `src/guardian/guardian.ts`

- [ ] **Step 1: Write the failing test**

Create `src/guardian/guardian.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { ExtSnapshot, Change, ExtTimestamps } from '../types';
import { classifySeverity, STABILITY_WINDOW_DAYS, type ClassifyCtx } from './guardian';

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;

function ext(o: Partial<ExtSnapshot> = {}): ExtSnapshot {
  return {
    id: 'a'.repeat(32), name: 'X', version: '1.0.0', enabled: true, type: 'extension',
    installType: 'normal', permissions: [], hostPermissions: [], mayDisable: true, ...o,
  };
}
function ctx(curr: ExtSnapshot[], prevTs: Record<string, ExtTimestamps> = {}, now = NOW): ClassifyCtx {
  return { currById: new Map(curr.map((e) => [e.id, e])), prevTimestamps: prevTs, now };
}
const id = 'a'.repeat(32);

describe('classifySeverity', () => {
  it('host-scope expansion is high', () => {
    const c: Change = { kind: 'permissions-added', id, name: 'X', permissions: ['<all_urls>'] };
    expect(classifySeverity(c, ctx([ext()]))).toBe('high');
    const c2: Change = { kind: 'permissions-added', id, name: 'X', permissions: ['https://e.com/*'] };
    expect(classifySeverity(c2, ctx([ext()]))).toBe('high');
  });

  it('API-permission-only addition is notable', () => {
    const c: Change = { kind: 'permissions-added', id, name: 'X', permissions: ['cookies'] };
    expect(classifySeverity(c, ctx([ext()]))).toBe('notable');
  });

  it('publisher (updateUrl) change is high', () => {
    const c: Change = { kind: 'publisher-changed', id, name: 'X', from: 'a', to: 'b' };
    expect(classifySeverity(c, ctx([ext()]))).toBe('high');
  });

  it('version bump at or beyond the stability window is notable', () => {
    const c: Change = { kind: 'version-changed', id, name: 'X', from: '1', to: '2' };
    const prevTs = { [id]: { firstSeen: 0, lastVersionChange: NOW - STABILITY_WINDOW_DAYS * DAY } };
    expect(classifySeverity(c, ctx([ext()], prevTs))).toBe('notable');
  });

  it('version bump within the stability window is info (silent)', () => {
    const c: Change = { kind: 'version-changed', id, name: 'X', from: '1', to: '2' };
    const prevTs = { [id]: { firstSeen: 0, lastVersionChange: NOW - 59 * DAY } };
    expect(classifySeverity(c, ctx([ext()], prevTs))).toBe('info');
  });

  it('sideloaded/development install is high', () => {
    const c: Change = { kind: 'installed', id, name: 'X' };
    expect(classifySeverity(c, ctx([ext({ installType: 'sideload' })]))).toBe('high');
    expect(classifySeverity(c, ctx([ext({ installType: 'development' })]))).toBe('high');
  });

  it('normal install of a high/critical-tier extension is notable', () => {
    const c: Change = { kind: 'installed', id, name: 'X' };
    expect(classifySeverity(c, ctx([ext({ hostPermissions: ['<all_urls>'] })]))).toBe('notable');
  });

  it('normal install of a low-risk extension is info (silent)', () => {
    const c: Change = { kind: 'installed', id, name: 'X' };
    expect(classifySeverity(c, ctx([ext()]))).toBe('info');
  });

  it('capability decreases are info (silent)', () => {
    const removedPerm: Change = { kind: 'permissions-removed', id, name: 'X', permissions: ['cookies'] };
    const removedExt: Change = { kind: 'removed', id, name: 'X' };
    expect(classifySeverity(removedPerm, ctx([ext()]))).toBe('info');
    expect(classifySeverity(removedExt, ctx([]))).toBe('info');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/guardian/guardian.test.ts`
Expected: FAIL — `Cannot find module './guardian'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/guardian/guardian.ts`:

```ts
// guardian/ — pure scan-evaluation engine (design spec §3.2). No I/O.
// Decides what changed, how serious it is, what to persist, and whether/what to
// notify — deterministically, from injected data. `now` is a parameter, never a clock.

import type {
  ExtSnapshot, Change, Severity, ClassifiedChange, ScanInput, ScanResult, ExtTimestamps,
} from '../types';
import { diff } from '../snapshot/snapshot';
import { scoreExtension } from '../scoring/scoring';
import { trace } from '../debug';

const tGuardian = trace('sec.guardian');

/** A version bump after this many stable days is treated as noteworthy. Tunable (spec §2). */
export const STABILITY_WINDOW_DAYS = 60;
const DAY_MS = 86_400_000;

/** A diff-reported capability is a host match pattern (vs an API permission). */
const isHostPattern = (p: string): boolean => p === '<all_urls>' || p.includes('://');

export interface ClassifyCtx {
  currById: Map<string, ExtSnapshot>;
  prevTimestamps: Record<string, ExtTimestamps>;
  now: number;
}

export function classifySeverity(change: Change, ctx: ClassifyCtx): Severity {
  switch (change.kind) {
    case 'permissions-added':
      return change.permissions.some(isHostPattern) ? 'high' : 'notable';
    case 'publisher-changed':
      return 'high';
    case 'version-changed': {
      const last = ctx.prevTimestamps[change.id]?.lastVersionChange;
      return last !== undefined && ctx.now - last >= STABILITY_WINDOW_DAYS * DAY_MS ? 'notable' : 'info';
    }
    case 'installed': {
      const ext = ctx.currById.get(change.id);
      if (!ext) return 'info';
      if (ext.installType === 'development' || ext.installType === 'sideload') return 'high';
      const tier = scoreExtension(ext).tier;
      return tier === 'critical' || tier === 'high' ? 'notable' : 'info';
    }
    case 'permissions-removed':
    case 'removed':
      return 'info';
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/guardian/guardian.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/guardian/guardian.ts src/guardian/guardian.test.ts
git commit -m "feat: guardian severity classification (research-grounded table)"
```

---

## Task 4: `guardian/` — `evaluateScan`

**Files:**
- Modify: `src/guardian/guardian.test.ts` (append a describe block)
- Modify: `src/guardian/guardian.ts` (append helpers + `evaluateScan`)

- [ ] **Step 1: Write the failing test**

Append to `src/guardian/guardian.test.ts`:

```ts
import { evaluateScan } from './guardian';
import type { Settings } from '../types';

const SETTINGS: Settings = { monitoringEnabled: true, scanIntervalMinutes: 5, notify: true };

describe('evaluateScan', () => {
  const A = 'a'.repeat(32), B = 'b'.repeat(32), C = 'c'.repeat(32);

  it('first run (empty prev) establishes a silent baseline — no notification', () => {
    const r = evaluateScan({
      prev: [], curr: [ext({ id: A, hostPermissions: ['<all_urls>'] })],
      timestamps: {}, settings: SETTINGS, ignored: [], now: NOW,
    });
    expect(r.notification).toBeNull();
    expect(r.classified).toEqual([]);
    expect(r.timestamps[A]).toEqual({ firstSeen: NOW, lastVersionChange: NOW });
  });

  it('suppresses changes for ignored extensions', () => {
    const r = evaluateScan({
      prev: [ext({ id: A })], curr: [ext({ id: A, hostPermissions: ['<all_urls>'] })],
      timestamps: { [A]: { firstSeen: 0, lastVersionChange: 0 } },
      settings: SETTINGS, ignored: [A], now: NOW,
    });
    expect(r.classified).toEqual([]);
    expect(r.notification).toBeNull();
  });

  it('batches multiple noteworthy changes into one notification', () => {
    const r = evaluateScan({
      prev: [ext({ id: A }), ext({ id: B, updateUrl: 'http://old' })],
      curr: [ext({ id: A, hostPermissions: ['<all_urls>'] }), ext({ id: B, updateUrl: 'http://new' })],
      timestamps: { [A]: { firstSeen: 0, lastVersionChange: 0 }, [B]: { firstSeen: 0, lastVersionChange: 0 } },
      settings: SETTINGS, ignored: [], now: NOW,
    });
    expect(r.notification?.title).toBe('Ext-Ray: 2 changes need review');
  });

  it('stays silent when notifications are disabled, but still classifies + updates timestamps', () => {
    const r = evaluateScan({
      prev: [ext({ id: A })], curr: [ext({ id: A, hostPermissions: ['<all_urls>'] })],
      timestamps: { [A]: { firstSeen: 0, lastVersionChange: 0 } },
      settings: { ...SETTINGS, notify: false }, ignored: [], now: NOW,
    });
    expect(r.notification).toBeNull();
    expect(r.classified).toHaveLength(1);
  });

  it('updates timestamps: new id, version bump, carry-forward, and drops removed ids', () => {
    const r = evaluateScan({
      prev: [ext({ id: A, version: '1.0.0' }), ext({ id: B })],
      curr: [ext({ id: A, version: '2.0.0' }), ext({ id: C })],
      timestamps: { [A]: { firstSeen: 100, lastVersionChange: 100 }, [B]: { firstSeen: 200, lastVersionChange: 200 } },
      settings: SETTINGS, ignored: [], now: NOW,
    });
    expect(r.timestamps[A]).toEqual({ firstSeen: 100, lastVersionChange: NOW }); // bump
    expect(r.timestamps[C]).toEqual({ firstSeen: NOW, lastVersionChange: NOW }); // new
    expect(r.timestamps[B]).toBeUndefined();                                     // removed
  });

  it('is deterministic — same input, same result', () => {
    const input = {
      prev: [ext({ id: A })], curr: [ext({ id: A, hostPermissions: ['<all_urls>'] })],
      timestamps: { [A]: { firstSeen: 0, lastVersionChange: 0 } },
      settings: SETTINGS, ignored: [], now: NOW,
    };
    expect(evaluateScan(input)).toEqual(evaluateScan(input));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/guardian/guardian.test.ts`
Expected: FAIL — `evaluateScan` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/guardian/guardian.ts`:

```ts
function nextTimestamps(
  prevTimestamps: Record<string, ExtTimestamps>,
  curr: ExtSnapshot[],
  changes: Change[],
  now: number,
): Record<string, ExtTimestamps> {
  const versionChanged = new Set(changes.filter((c) => c.kind === 'version-changed').map((c) => c.id));
  const next: Record<string, ExtTimestamps> = {};
  for (const e of curr) {
    const prevTs = prevTimestamps[e.id];
    next[e.id] = prevTs
      ? { firstSeen: prevTs.firstSeen, lastVersionChange: versionChanged.has(e.id) ? now : prevTs.lastVersionChange }
      : { firstSeen: now, lastVersionChange: now };
  }
  return next;
}

function describe_({ change }: ClassifiedChange): string {
  switch (change.kind) {
    case 'installed': return `${change.name} was installed`;
    case 'permissions-added': return `${change.name} gained: ${change.permissions.join(', ')}`;
    case 'publisher-changed': return `${change.name} changed its update source`;
    case 'version-changed': return `${change.name} updated after a long stable period`;
    case 'permissions-removed': return `${change.name} removed permissions`;
    case 'removed': return `${change.name} was removed`;
  }
}

function buildNotification(noteworthy: ClassifiedChange[]): { title: string; message: string } | null {
  if (noteworthy.length === 0) return null;
  const n = noteworthy.length;
  const title = `Ext-Ray: ${n} change${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} review`;
  const lines = noteworthy.slice(0, 5).map((c) => `• ${describe_(c)}`);
  if (n > 5) lines.push(`…and ${n - 5} more`);
  return { title, message: lines.join('\n') };
}

export function evaluateScan(input: ScanInput): ScanResult {
  const { prev, curr, timestamps, settings, ignored, now } = input;
  const changes = diff(prev, curr);
  const newTimestamps = nextTimestamps(timestamps, curr, changes, now);

  // First run / baseline: establish silently, no notification storm (spec §6, §8).
  if (prev.length === 0) {
    if (tGuardian.enabled) tGuardian('baseline established', { curr: curr.length });
    return { timestamps: newTimestamps, classified: [], notification: null };
  }

  const ignoredSet = new Set(ignored);
  const ctx: ClassifyCtx = { currById: new Map(curr.map((e) => [e.id, e])), prevTimestamps: timestamps, now };
  const classified: ClassifiedChange[] = changes
    .filter((c) => !ignoredSet.has(c.id))
    .map((change) => ({ change, severity: classifySeverity(change, ctx) }));

  const noteworthy = classified.filter((c) => c.severity !== 'info');
  const notification = settings.notify ? buildNotification(noteworthy) : null;

  if (tGuardian.enabled) {
    tGuardian('scan evaluated', {
      changes: classified.length, noteworthy: noteworthy.length, notified: notification !== null,
    });
  }
  return { timestamps: newTimestamps, classified, notification };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/guardian/guardian.test.ts`
Expected: PASS (15 tests total in the file).

- [ ] **Step 5: Commit**

```bash
git add src/guardian/guardian.ts src/guardian/guardian.test.ts
git commit -m "feat: guardian evaluateScan (batched, severity-gated, first-run safe)"
```

---

## Task 5: `background/` — service-worker glue

**Files:**
- Create: `src/background/index.ts`

**No unit test here (deliberate, per spec §9):** this file is thin `chrome.*` wiring with no decision logic — all decisions live in the unit-tested `guardian/` core. Full wiring is integration-tested in Phase 8 (load-unpacked + Playwright). Each line is glue: register listeners, gather inputs, call `evaluateScan`, perform effects.

**Dependency note:** `chrome.notifications.create` needs an `iconUrl`. `icons/icon-128.png` does not exist yet — it is added in Phase 5 (build) / Phase 9 (assets). The service worker is not executed until Phase 5, so this is a forward reference, not a Phase 4 break.

- [ ] **Step 1: Write the service worker**

Create `src/background/index.ts`:

```ts
// background/ — the MV3 service worker (design spec §3.3). Thin glue only:
// wiring + I/O. All decisions are in the pure guardian core. Date.now() lives
// here (the edge), never in the pure core. Integration-tested in Phase 8.

import { getExtensions } from '../management/management';
import { evaluateScan } from '../guardian/guardian';
import { getSnapshot, setSnapshot, getTimestamps, setTimestamps, getSettings, getIgnored, migrate } from '../storage/storage';
import { trace } from '../debug';

const ALARM_NAME = 'extray-scan';
const tPerf = trace('perf.guardian');

// Serialize scans: an in-flight scan finishes before the next starts, so a
// near-simultaneous event + alarm tick can't race the snapshot read/persist (spec §6).
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
      iconUrl: 'icons/icon-128.png',
      title: result.notification.title,
      message: result.notification.message,
    });
  }
  await Promise.all([setSnapshot(curr), setTimestamps(result.timestamps)]);
  if (tPerf.enabled) tPerf('scan complete', { ms: Date.now() - start, count: curr.length });
}

async function ensureAlarm(): Promise<void> {
  if (await chrome.alarms.get(ALARM_NAME)) return;
  const { scanIntervalMinutes } = await getSettings();
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: scanIntervalMinutes });
}

async function init(): Promise<void> {
  await migrate();
  await ensureAlarm();
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
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: OK (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/background/index.ts
git commit -m "feat: background guardian service worker (wiring + serialized scans)"
```

---

## Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full suite**

Run: `npx vitest run`
Expected: PASS — all prior tests plus 3 (management) + 15 (guardian) = **61 tests**.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: OK.

- [ ] **Step 3: Confirm the guardian trace toggles**

Run: `EXTRAY_DEBUG=sec.* npx vitest run src/guardian/guardian.test.ts --reporter=verbose`
Expected: lines like `[sec.guardian] scan evaluated { ... }` appear; with no env var, none do.

---

## Self-review notes (spec coverage)

- Spec §3.1 `management/` → Task 2. §3.2 `guardian/` pure core → Tasks 3–4. §3.3 `background/` → Task 5.
- §4 types → Task 1. §5 severity table → Task 3 (one test per row). §6 invariants: first-run (Task 4), notify-once + serialization (Task 5 `scheduleScan`), injected `now` (Tasks 3–4). §7 boundary handling: empty/unavailable getAll → empty array (Task 2 normalize), self-heal alarm (Task 5 `ensureAlarm`). §8 instrumentation: `sec.guardian` (Task 4), `perf.guardian` (Task 5). §9 testing strategy honored (pure core TDD'd; SW glue → Phase 8). §10 scope: no C1 display, no settings UI, no severity persistence — none appear in any task.
