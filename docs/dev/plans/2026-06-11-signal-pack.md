# Signal Pack Implementation Plan (v0.0.2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four unscored informational signals (disabled-for-permissions, name-changed, non-store update source, shared update host) plus the F-01/F-02 correctness fixes and the ROADMAP test backfill, per `docs/dev/specs/2026-06-11-signal-pack-design.md`.

**Architecture:** Pure-core first (the codebase's invariant): two new `Change` kinds flow through `snapshot/diff` → `guardian/classifySeverity`; a new pure `src/signals/` module computes informational strings consumed by `report/buildReport`; the popup renders them as a muted `.signal` lane. Scoring weights are frozen — signals never touch tier/score/grade.

**Tech Stack:** TypeScript strict, Vitest (`npm test`), Playwright E2E (`npm run test:e2e`), hand-rolled two-pass Vite build (`npm run verify:build`).

**Repo rules (do not skip):**
- This repo is **PUBLIC**: commit as the plain author, **NO `Co-Authored-By` trailer**.
- Work on the feature branch `signal-pack` (Task 1 creates it). Never commit to `main`.
- Run commands from the repo root `/home/junny/Desktop/Ext-Ray`.

---

## File map

| File | Role in this plan |
|---|---|
| `src/types.ts` | +`ExtSnapshot.disabledReason?`, +2 `Change` kinds, +`signals` on `ReportCard`/`ReportRow` |
| `src/management/management.ts` | normalize `disabledReason` through |
| `src/snapshot/snapshot.ts` (+test) | emit `name-changed`, `disabled-for-permissions` |
| `src/guardian/guardian.ts` (+test) | classify + describe the new kinds |
| `src/signals/signals.ts` (+test) | **new** pure module: `fleetSignals()` |
| `src/report/report.ts` (+test) | thread `signals` onto cards/rows |
| `popup/render.ts`, `popup/popup.css` | muted `.signal` lane |
| `src/storage/storage.ts` (+test), `src/background/index.ts` | F-01 atomic write; F-02 awaited create |
| `src/scoring/scoring.test.ts`, `src/guardian/alarm.test.ts` | backfill regression pins |
| `e2e/popup.spec.ts`, `e2e/options.spec.ts` | E2E backfill |
| `public/manifest.json`, `package.json`, `docs/ROADMAP.md`, `README.md` | v0.0.2 + docs |

---

### Task 1: Branch + `disabledReason` on the snapshot contract

**Files:**
- Modify: `src/types.ts` (ExtSnapshot, after the `iconUrl` field ~line 22)
- Modify: `src/management/management.ts` (`normalize()`, ~line 18)

- [ ] **Step 1: Create the feature branch**

```bash
git checkout -b signal-pack
```

- [ ] **Step 2: Add the field to `ExtSnapshot`** in `src/types.ts`, after the `iconUrl` member:

```ts
  /** chrome.management ExtensionInfo.disabledReason — enum is exactly 'unknown' |
   *  'permissions_increase'. Only 'permissions_increase' is actionable (Chrome itself
   *  disabled the extension because an update requested more permissions). Optional +
   *  additive: old stored snapshots lack it; no schema migration needed. */
  disabledReason?: string;
```

- [ ] **Step 3: Map it through the management edge** in `src/management/management.ts` `normalize()`, after the `updateUrl: e.updateUrl,` line:

```ts
    disabledReason: e.disabledReason,
```

If the installed chrome typings predate the field, use `disabledReason: (e as { disabledReason?: string }).disabledReason,` instead — but try the direct form first.

- [ ] **Step 4: Verify compile + suite still green**

Run: `npm run typecheck && npm test`
Expected: tsc silent; `Tests  101 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/management/management.ts
git commit -m "feat(types,management): carry disabledReason on ExtSnapshot (signal pack)"
```

---

### Task 2: `name-changed` Change kind

**Files:**
- Modify: `src/types.ts` (the `Change` union, ~line 56)
- Modify: `src/snapshot/snapshot.ts` (per-extension loop, after the `publisher-changed` check ~line 53)
- Modify: `src/guardian/guardian.ts` (`classifySeverity` ~line 37, `describeChange` ~line 78)
- Test: `src/snapshot/snapshot.test.ts`, `src/guardian/guardian.test.ts`

- [ ] **Step 1: Write the failing diff tests** — append inside the `describe('diff', …)` block of `src/snapshot/snapshot.test.ts`:

```ts
  // Signal pack: identity churn (name) is a tracked Change — info severity, paper-backed.
  it('detects a renamed extension (from → to)', () => {
    const prev = [ext({ name: 'Honest Tool' })];
    const curr = [ext({ name: 'Shiny Rebrand' })];
    expect(diff(prev, curr)).toEqual([
      { kind: 'name-changed', id: 'a'.repeat(32), from: 'Honest Tool', to: 'Shiny Rebrand' },
    ]);
  });

  it('does not report name-changed on first sight (install only)', () => {
    expect(diff([], [ext({ name: 'Brand New' })])).toEqual([
      { kind: 'installed', id: 'a'.repeat(32), name: 'Brand New' },
    ]);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/snapshot/snapshot.test.ts`
Expected: FAIL — TypeScript error (`'name-changed'` not in the `Change` union) or empty-diff assertion failure.

- [ ] **Step 3: Implement.** In `src/types.ts`, add to the `Change` union (after the `publisher-changed` member):

```ts
  | { kind: 'name-changed'; id: string; from: string; to: string }
```

> **Executed-as amendment:** review added `name: string` (the post-rename name) to this shape so
> every Change kind is self-describing — see the spec §4.1 amendment. Emission passes `name: e.name`.

In `src/snapshot/snapshot.ts`, after the `publisher-changed` check inside the loop:

```ts
    if (before.name !== e.name) {
      changes.push({ kind: 'name-changed', id: e.id, from: before.name, to: e.name });
    }
```

In `src/guardian/guardian.ts` — `classifySeverity`: add `'name-changed'` to the existing info group:

```ts
    case 'name-changed':
    case 'permissions-removed':
    case 'removed':
      return 'info';
```

`describeChange`: add (unreachable in notifications while `info`, but the switch is total):

```ts
    case 'name-changed': return `“${change.from}” was renamed to “${change.to}”`;
```

- [ ] **Step 4: Write the failing severity tests** — append in `describe('classifySeverity', …)` of `src/guardian/guardian.test.ts`:

```ts
  it('a rename is info — identity churn is context, never an alert by itself', () => {
    const c: Change = { kind: 'name-changed', id, from: 'A', to: 'B' };
    expect(classifySeverity(c, ctx([ext()]))).toBe('info');
  });
```

And in the `evaluateScan` describe block (info churn on a trusted extension stays silent — the existing trusted filter must hold for the new kind):

```ts
  it('a rename of a trusted extension is silenced and does not revoke trust', () => {
    const prev = [ext({ name: 'Before' })];
    const curr = [ext({ name: 'After' })];
    const result = evaluateScan({
      prev, curr, timestamps: { [id]: { firstSeen: 0, lastVersionChange: 0 } },
      settings: { monitoringEnabled: true, scanIntervalMinutes: 5, notify: true },
      trusted: [id], now: NOW,
    });
    expect(result.classified).toEqual([]);
    expect(result.revokeTrust).toEqual([]);
    expect(result.notification).toBeNull();
  });
```

- [ ] **Step 5: Run both suites to verify pass**

Run: `npx vitest run src/snapshot/snapshot.test.ts src/guardian/guardian.test.ts`
Expected: PASS (all, including the 2 + 1 new).

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/snapshot/snapshot.ts src/guardian/guardian.ts src/snapshot/snapshot.test.ts src/guardian/guardian.test.ts
git commit -m "feat(snapshot,guardian): name-changed Change kind at info severity"
```

---

### Task 3: `disabled-for-permissions` Change kind (transition-guarded, high severity)

**Files:**
- Modify: `src/types.ts` (`Change` union)
- Modify: `src/snapshot/snapshot.ts` (loop)
- Modify: `src/guardian/guardian.ts` (`classifySeverity`, `describeChange`)
- Test: `src/snapshot/snapshot.test.ts`, `src/guardian/guardian.test.ts`

- [ ] **Step 1: Write the failing diff tests** — append a new describe block in `src/snapshot/snapshot.test.ts`:

```ts
describe('disabled-for-permissions transition', () => {
  it('fires when Chrome disables an extension for a permissions increase', () => {
    const prev = [ext({ enabled: true })];
    const curr = [ext({ enabled: false, disabledReason: 'permissions_increase' })];
    expect(diff(prev, curr)).toEqual([
      { kind: 'disabled-for-permissions', id: 'a'.repeat(32), name: 'Test Extension' },
    ]);
  });

  it('does NOT fire for an extension already disabled at first sight (install only)', () => {
    const curr = [ext({ enabled: false, disabledReason: 'permissions_increase' })];
    expect(diff([], curr)).toEqual([
      { kind: 'installed', id: 'a'.repeat(32), name: 'Test Extension' },
    ]);
  });

  it('does NOT fire when prev was already disabled (no transition — e.g. the field first appearing after an Ext-Ray update)', () => {
    const prev = [ext({ enabled: false })];
    const curr = [ext({ enabled: false, disabledReason: 'permissions_increase' })];
    expect(diff(prev, curr)).toEqual([]);
  });

  it('does NOT fire for disabledReason "unknown"', () => {
    const prev = [ext({ enabled: true })];
    const curr = [ext({ enabled: false, disabledReason: 'unknown' })];
    expect(diff(prev, curr)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/snapshot/snapshot.test.ts`
Expected: FAIL (union/type error, then empty diff).

- [ ] **Step 3: Implement.** `src/types.ts` `Change` union:

```ts
  | { kind: 'disabled-for-permissions'; id: string; name: string }
```

`src/snapshot/snapshot.ts`, after the `name-changed` check:

```ts
    // Transition-guarded (spec §4.3): fires only on an OBSERVED enabled→disabled flip with
    // Chrome's permissions_increase reason. Already-disabled at first sight (or when the
    // disabledReason field first appears after Ext-Ray's own update) emits nothing — the
    // state still surfaces via the signals lane.
    if (before.enabled && !e.enabled && e.disabledReason === 'permissions_increase') {
      changes.push({ kind: 'disabled-for-permissions', id: e.id, name: e.name });
    }
```

`src/guardian/guardian.ts` `classifySeverity` (new case above the info group):

```ts
    case 'disabled-for-permissions':
      // Chrome itself blocked a permission escalation pending re-approval — the same
      // class as permissions-added(host), and the only observable of the attempt
      // (the pending permissions may not appear in permissions[] yet).
      return 'high';
```

`describeChange`:

```ts
    case 'disabled-for-permissions': return `${change.name} was disabled: its update requested more permissions`;
```

- [ ] **Step 4: Write the failing guardian tests** — severity test in `describe('classifySeverity', …)`; trust-interplay test in the `evaluateScan` describe block of `src/guardian/guardian.test.ts` (reuse the file's `settings`-style literals; `evaluateScan` and `NOW` are already imported/defined):

```ts
  it('disabled-for-permissions is high — Chrome itself confirmed an escalation attempt', () => {
    const c: Change = { kind: 'disabled-for-permissions', id, name: 'X' };
    expect(classifySeverity(c, ctx([ext()]))).toBe('high');
  });
```

```ts
  it('disabled-for-permissions on a trusted extension alerts AND revokes trust', () => {
    const prev = [ext({ enabled: true })];
    const curr = [ext({ enabled: false, disabledReason: 'permissions_increase' })];
    const result = evaluateScan({
      prev, curr, timestamps: { [id]: { firstSeen: 0, lastVersionChange: 0 } },
      settings: { monitoringEnabled: true, scanIntervalMinutes: 5, notify: true },
      trusted: [id], now: NOW,
    });
    expect(result.revokeTrust).toEqual([id]);
    expect(result.notification).not.toBeNull();
    expect(result.notification!.message).toContain('was disabled: its update requested more permissions');
  });
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run src/snapshot/snapshot.test.ts src/guardian/guardian.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/snapshot/snapshot.ts src/guardian/guardian.ts src/snapshot/snapshot.test.ts src/guardian/guardian.test.ts
git commit -m "feat(snapshot,guardian): disabled-for-permissions transition at high severity"
```

---

### Task 4: Pure `signals/` module

**Files:**
- Create: `src/signals/signals.ts`
- Create: `src/signals/signals.test.ts`

- [ ] **Step 1: Write the failing test file** — create `src/signals/signals.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { ExtSnapshot } from '../types';
import { fleetSignals } from './signals';

function ext(o: Partial<ExtSnapshot> = {}): ExtSnapshot {
  return {
    id: 'a'.repeat(32), name: 'X', version: '1.0.0', enabled: true, type: 'extension',
    installType: 'normal', permissions: [], hostPermissions: [], mayDisable: true, ...o,
  };
}
const CWS = 'https://clients2.google.com/service/update2/crx';
const EDGE = 'https://edge.microsoft.com/extensionwebstorebase/v1/crx';

describe('fleetSignals', () => {
  it('returns an empty list for a plain store-updated extension', () => {
    expect(fleetSignals([ext({ updateUrl: CWS })]).get('a'.repeat(32))).toEqual([]);
  });

  it('never flags an absent updateUrl (the normal CWS case)', () => {
    expect(fleetSignals([ext()]).get('a'.repeat(32))).toEqual([]);
  });

  it('does not flag the Edge Add-ons store host', () => {
    expect(fleetSignals([ext({ updateUrl: EDGE })]).get('a'.repeat(32))).toEqual([]);
  });

  it('notes a disabled-for-permissions state', () => {
    const s = fleetSignals([ext({ enabled: false, disabledReason: 'permissions_increase' })]);
    expect(s.get('a'.repeat(32))).toEqual([
      'Chrome disabled this extension: an update requested more permissions',
    ]);
  });

  it('says nothing about a disabled extension with reason "unknown"', () => {
    expect(fleetSignals([ext({ enabled: false, disabledReason: 'unknown' })]).get('a'.repeat(32))).toEqual([]);
  });

  it('notes a non-store update source', () => {
    const s = fleetSignals([ext({ updateUrl: 'https://updates.example.com/ext.xml' })]);
    expect(s.get('a'.repeat(32))).toEqual(['Updates from outside the official extension store']);
  });

  it('adds enterprise context for admin installs', () => {
    const s = fleetSignals([ext({ installType: 'admin', updateUrl: 'https://corp.example.com/u.xml' })]);
    expect(s.get('a'.repeat(32))).toEqual([
      'Updates from outside the official extension store (enterprise-managed installs commonly self-host)',
    ]);
  });

  it('safe-fails a malformed updateUrl as non-store (over-notes, never under-notes)', () => {
    const s = fleetSignals([ext({ updateUrl: 'not a url' })]);
    expect(s.get('a'.repeat(32))).toEqual(['Updates from outside the official extension store']);
  });

  it('flags a shared non-store host on every member of the cluster', () => {
    const a = ext({ id: 'a'.repeat(32), updateUrl: 'https://u.example.com/a.xml' });
    const b = ext({ id: 'b'.repeat(32), updateUrl: 'https://u.example.com/b.xml' });
    const s = fleetSignals([a, b]);
    const shared = 'Updates from the same server (u.example.com) as 1 other installed extension — could be one developer or one operator';
    expect(s.get('a'.repeat(32))).toContain(shared);
    expect(s.get('b'.repeat(32))).toContain(shared);
  });

  it('counts peers for a 3-extension cluster (n = 2 each, plural)', () => {
    const ids = ['a', 'b', 'c'].map((ch) => ch.repeat(32));
    const fleet = ids.map((id) => ext({ id, updateUrl: 'https://u.example.com/x.xml' }));
    const s = fleetSignals(fleet);
    for (const id of ids) {
      expect(s.get(id)!.some((t) => t.includes('as 2 other installed extensions'))).toBe(true);
    }
  });

  it('never clusters extensions sharing a STORE host', () => {
    const a = ext({ id: 'a'.repeat(32), updateUrl: CWS });
    const b = ext({ id: 'b'.repeat(32), updateUrl: CWS });
    const s = fleetSignals([a, b]);
    expect(s.get('a'.repeat(32))).toEqual([]);
    expect(s.get('b'.repeat(32))).toEqual([]);
  });

  it('is deterministic and covers every input id', () => {
    const fleet = [ext({ id: 'a'.repeat(32) }), ext({ id: 'b'.repeat(32), updateUrl: CWS })];
    expect(fleetSignals(fleet)).toEqual(fleetSignals(fleet));
    expect([...fleetSignals(fleet).keys()].sort()).toEqual([fleet[0]!.id, fleet[1]!.id].sort());
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/signals/signals.test.ts`
Expected: FAIL — cannot resolve `./signals`.

- [ ] **Step 3: Implement** — create `src/signals/signals.ts`:

```ts
// signals/ — pure informational-signal engine (signal-pack spec §4.5). No I/O.
//
// Signals are CONTEXT, never verdicts: zero score weight, never change a tier,
// rendered in their own muted lane (the Amazon-Inspector "informational" model —
// reported, never summed). Domain: a normalized fleet snapshot. Codomain: each
// id → 0–3 short plain-English strings. O(N) over the fleet; deterministic; no clock.

import type { ExtSnapshot } from '../types';

/** Official store update hosts — Chrome Web Store and Edge Add-ons (Ext-Ray runs on both;
 *  allowlisting only CWS would flag an entire Edge fleet — alert-fatigue by design error). */
const STORE_HOSTS = new Set(['clients2.google.com', 'edge.microsoft.com']);

/** Hostname of a declared updateUrl; null when absent (the normal CWS case — never a signal).
 *  A malformed URL (near-impossible from Chrome) safe-fails to '' — treated as non-store,
 *  over-noting rather than under-noting (same philosophy as scoring's hostWeight). */
function updateHost(updateUrl: string | undefined): string | null {
  if (!updateUrl) return null;
  try {
    return new URL(updateUrl).hostname;
  } catch {
    return '';
  }
}

/** Informational, unscored signals per extension. Every input id gets an entry (possibly []). */
export function fleetSignals(snapshots: ExtSnapshot[]): Map<string, string[]> {
  // Pass 1: group ids by non-store update host for the cluster signal.
  const byHost = new Map<string, string[]>();
  for (const e of snapshots) {
    const host = updateHost(e.updateUrl);
    if (host !== null && !STORE_HOSTS.has(host)) {
      byHost.set(host, [...(byHost.get(host) ?? []), e.id]);
    }
  }

  // Pass 2: per-extension signal strings (exact copy from spec §4.5).
  const out = new Map<string, string[]>();
  for (const e of snapshots) {
    const signals: string[] = [];
    if (!e.enabled && e.disabledReason === 'permissions_increase') {
      signals.push('Chrome disabled this extension: an update requested more permissions');
    }
    const host = updateHost(e.updateUrl);
    if (host !== null && !STORE_HOSTS.has(host)) {
      signals.push(
        e.installType === 'admin'
          ? 'Updates from outside the official extension store (enterprise-managed installs commonly self-host)'
          : 'Updates from outside the official extension store',
      );
      const peers = (byHost.get(host)?.length ?? 1) - 1;
      if (peers >= 1) {
        signals.push(
          `Updates from the same server (${host}) as ${peers} other installed extension${peers === 1 ? '' : 's'} — could be one developer or one operator`,
        );
      }
    }
    out.set(e.id, signals);
  }
  return out;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/signals/signals.test.ts`
Expected: PASS — 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/signals/signals.ts src/signals/signals.test.ts
git commit -m "feat(signals): pure informational-signal engine (non-store source, shared host, disable state)"
```

---

### Task 5: Thread `signals` through the report

**Files:**
- Modify: `src/types.ts` (`ReportCard` + `ReportRow`)
- Modify: `src/report/report.ts`
- Test: `src/report/report.test.ts`

- [ ] **Step 1: Write the failing tests** — append a new describe block in `src/report/report.test.ts`:

```ts
describe('informational signals (signal pack)', () => {
  it('threads signals onto risky cards, low rows, and trusted cards', () => {
    const crit = ext({ id: 'c'.repeat(32), hostPermissions: ['<all_urls>'], updateUrl: 'https://u.example.com/c.xml' });
    const low = ext({ id: 'l'.repeat(32), updateUrl: 'https://u.example.com/l.xml' });
    const tr = ext({ id: 't'.repeat(32), enabled: false, disabledReason: 'permissions_increase' });
    const r = buildReport([crit, low, tr], ['t'.repeat(32)]);
    expect(r.risky[0]!.signals.some((s) => s.includes('outside the official extension store'))).toBe(true);
    expect(r.risky[0]!.signals.some((s) => s.includes('same server (u.example.com)'))).toBe(true);
    expect(r.low[0]!.signals.some((s) => s.includes('outside the official extension store'))).toBe(true);
    expect(r.trusted[0]!.signals).toEqual(['Chrome disabled this extension: an update requested more permissions']);
  });

  it('signals never affect the grade', () => {
    const plain = ext({ id: 'a'.repeat(32) });
    const noted = ext({ id: 'b'.repeat(32), updateUrl: 'https://u.example.com/x.xml' });
    const bare = ext({ id: 'b'.repeat(32) });
    expect(buildReport([plain, noted]).grade).toEqual(buildReport([plain, bare]).grade);
  });

  it('defaults to an empty signals array', () => {
    const r = buildReport([ext()]);
    expect(r.low[0]!.signals).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/report/report.test.ts`
Expected: FAIL — `signals` does not exist on `ReportCard`/`ReportRow`.

- [ ] **Step 3: Implement.** In `src/types.ts`, add to **both** `ReportCard` and `ReportRow` (after `iconUrl`):

```ts
  /** Informational signals (signal-pack spec §4.5) — unscored context, never affects tier/score. */
  signals: string[];
```

In `src/report/report.ts`:
- Add the import: `import { fleetSignals } from '../signals/signals';`
- At the top of `buildReport`, after `const trustedSet = …`: `const signals = fleetSignals(snapshots);`
- In the `card()` helper, add `signals: signals.get(snapshot.id) ?? [],` after `iconUrl: snapshot.iconUrl,`
- In the `low.push({…})` literal, add `signals: signals.get(snapshot.id) ?? [],` after `iconUrl: snapshot.iconUrl,`
- Extend the invariant comment at the top of the file with: `Signals are informational and never affect tier/score/order.`

- [ ] **Step 4: Run to verify pass + whole suite**

Run: `npm run typecheck && npm test`
Expected: tsc silent; all tests pass (the new 3 included). If popup/options type-check trips on the new required field, that is Task 6's render work — it should not, since the render layer only reads fields.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/report/report.ts src/report/report.test.ts
git commit -m "feat(report): thread informational signals onto cards and rows"
```

---

### Task 6: Popup signal lane (render + CSS)

**Files:**
- Modify: `popup/render.ts` (`renderCard` ~line 111, `renderRow` ~line 121, trusted loop ~line 165)
- Modify: `popup/popup.css` (after the `.warning` rules ~line 76)

- [ ] **Step 1: Render signals.** In `popup/render.ts` `renderCard`, after the reasons loop (`for (const reason of card.reasons) …`):

```ts
  for (const signal of card.signals) c.append(el('p', 'signal', signal));
```

In `renderRow`, before `r.append(renderActions(…))`:

```ts
  for (const signal of row.signals) r.append(el('p', 'signal', signal));
```

In the trusted-section loop inside `renderReport`, after the `r.append(iconImg(…), …)` line:

```ts
      for (const signal of t.signals) r.append(el('p', 'signal', signal));
```

- [ ] **Step 2: Style the lane.** In `popup/popup.css`, after the `.warning:empty { display: none; }` rule:

```css
/* Informational signals — unscored context lane (signal pack); visually distinct from .reason */
.signal { margin: 4px 0 0; color: var(--er-muted); font-size: 11px; }
.signal::before { content: 'ℹ '; opacity: .8; }
.row { flex-wrap: wrap; }
.row .signal { flex-basis: 100%; margin: 2px 0 0 32px; }
```

(The `.row` flex-wrap addition lets a full-width signal line sit under a one-line row; 32px ≈ icon 24px + 8px gap.)

- [ ] **Step 3: Verify build + E2E selector contract intact**

Run: `npm run typecheck && npm run verify:build && npm run test:e2e`
Expected: tsc silent; `check-dist: OK`; all 17 E2E pass (the signal lane is additive — fixture extensions have no updateUrl/disabledReason, so no signal renders for them).

- [ ] **Step 4: Commit**

```bash
git add popup/render.ts popup/popup.css
git commit -m "feat(popup): muted informational-signal lane on cards and rows"
```

---

### Task 7: F-01 — atomic snapshot+timestamps write

**Files:**
- Modify: `src/storage/storage.ts` (after `setTimestamps`, ~line 63)
- Modify: `src/background/index.ts` (`runScan` writes, ~line 55; imports ~line 8)
- Test: `src/storage/storage.test.ts`

- [ ] **Step 1: Write the failing test** — append in `src/storage/storage.test.ts` (a new describe block; `ext` helper exists in the file):

```ts
describe('atomic snapshot+timestamps write (F-01)', () => {
  it('persists both keys in a single set() call (one WriteBatch — no torn-write window)', async () => {
    let setCalls = 0;
    const orig = chrome.storage.local.set.bind(chrome.storage.local);
    chrome.storage.local.set = async (items: Record<string, unknown>) => {
      setCalls += 1;
      return orig(items);
    };
    const snap = [ext()];
    const ts = { [snap[0]!.id]: { firstSeen: 1, lastVersionChange: 2 } };
    await setSnapshotAndTimestamps(snap, ts);
    expect(setCalls).toBe(1);
    expect(await getSnapshot()).toEqual(snap);
    expect(await getTimestamps()).toEqual(ts);
  });
});
```

Add `setSnapshotAndTimestamps` to the import list at the top of the test file.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/storage/storage.test.ts`
Expected: FAIL — `setSnapshotAndTimestamps` is not exported.

- [ ] **Step 3: Implement.** In `src/storage/storage.ts`, after `setTimestamps`:

```ts
/** Atomically persist the COUPLED snapshot + timestamps keys in one storage.set —
 *  a single LevelDB WriteBatch, all-or-nothing — so an MV3 SW kill between two
 *  separate writes can never leave snapshot advanced while timestamps lags
 *  (threat-model F-01: a torn state could under-classify the next version bump). */
export async function setSnapshotAndTimestamps(
  snapshot: ExtSnapshot[],
  timestamps: Record<string, ExtTimestamps>,
): Promise<void> {
  await chrome.storage.local.set({ [KEYS.snapshot]: snapshot, [KEYS.timestamps]: timestamps });
  if (tStore.enabled) tStore('write', { key: 'snapshot+timestamps', items: 2 });
}
```

In `src/background/index.ts`: change the storage import to include `setSnapshotAndTimestamps` and drop `setSnapshot, setTimestamps` (they become unused there), then replace the writes line in `runScan`:

```ts
    const writes: Array<Promise<void>> = [setSnapshotAndTimestamps(curr, result.timestamps)];
```

(`setTrusted` stays a separate write — trust revocation is not torn-state-coupled to the snapshot.)

- [ ] **Step 4: Run to verify pass**

Run: `npm run typecheck && npx vitest run src/storage/storage.test.ts`
Expected: tsc silent (confirms no leftover unused imports); PASS.

- [ ] **Step 5: Commit**

```bash
git add src/storage/storage.ts src/storage/storage.test.ts src/background/index.ts
git commit -m "fix(storage,background): atomic snapshot+timestamps write closes the torn-state window (F-01)"
```

---

### Task 8: F-02 — await `alarms.create` + clamp-idempotency pin

**Files:**
- Modify: `src/background/index.ts` (`applyAlarmAction`, ~line 70)
- Test: `src/guardian/alarm.test.ts`

- [ ] **Step 1: Add the regression pin** — append in `describe('reconcileAlarm', …)` of `src/guardian/alarm.test.ts`:

```ts
  it('clamped create is idempotent — an existing 0.5-min alarm with a sub-minimum setting yields none', () => {
    expect(reconcileAlarm(settings({ scanIntervalMinutes: 0.1 }), { periodInMinutes: 0.5 })).toEqual({ kind: 'none' });
  });
```

- [ ] **Step 2: Run — this pins existing-correct behavior, so it passes immediately**

Run: `npx vitest run src/guardian/alarm.test.ts`
Expected: PASS (backfill pin, not TDD red).

- [ ] **Step 3: The one-word fix.** In `src/background/index.ts` `applyAlarmAction`, make the branches symmetric:

```ts
async function applyAlarmAction(action: AlarmAction): Promise<void> {
  if (action.kind === 'clear') await chrome.alarms.clear(ALARM_NAME);
  else if (action.kind === 'create') await chrome.alarms.create(ALARM_NAME, { periodInMinutes: action.periodInMinutes });
}
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm test`
Expected: clean + all pass.

- [ ] **Step 5: Commit**

```bash
git add src/background/index.ts src/guardian/alarm.test.ts
git commit -m "fix(background): await alarms.create — symmetric with clear (F-02); pin clamp idempotency"
```

---

### Task 9: Unit-test backfill batch (regression pins on frozen behavior)

**Files:**
- Test: `src/scoring/scoring.test.ts`, `src/storage/storage.test.ts`, `src/guardian/guardian.test.ts`

- [ ] **Step 1: Scoring pins** — append in `describe('scoreExtension', …)` and `describe('gradeFleet', …)` of `src/scoring/scoring.test.ts`:

```ts
  // Backfill pins (frozen weights — these document existing behavior)
  it('bumps risk for installType "other" but not for enterprise "admin"', () => {
    const base = { permissions: ['storage'] };
    const normal = scoreExtension(ext({ ...base, installType: 'normal' }));
    const other = scoreExtension(ext({ ...base, installType: 'other' }));
    const admin = scoreExtension(ext({ ...base, installType: 'admin' }));
    expect(other.score).toBeGreaterThan(normal.score);
    expect(admin.score).toBe(normal.score);
  });

  it('ignores updateUrl entirely — provenance is a signal, not a score input', () => {
    const plain = scoreExtension(ext({ permissions: ['tabs'] }));
    const selfHosted = scoreExtension(ext({ permissions: ['tabs'], updateUrl: 'https://u.example.com/x.xml' }));
    expect(selfHosted).toEqual(plain);
  });
```

In `describe('gradeFleet', …)` (the local `verdict` helper exists):

```ts
  it('grades a single-extension fleet at exactly that extension score', () => {
    expect(gradeFleet([verdict(0.42)]).score).toBe(0.42);
  });
```

- [ ] **Step 2: Storage pin** — append in `describe('schema versioning', …)` of `src/storage/storage.test.ts`:

```ts
  it('migrate() never downgrades — a future schema version is left untouched', async () => {
    await chrome.storage.local.set({ schemaVersion: 99, trusted: ['x'] });
    await migrate();
    const all = await chrome.storage.local.get(null);
    expect(all.schemaVersion).toBe(99);
    expect(all.trusted).toEqual(['x']);
  });
```

- [ ] **Step 3: Guardian pin** — append in `describe('classifySeverity', …)` of `src/guardian/guardian.test.ts`:

```ts
  it('version bump with no stored history is info — a first-tracked change is not "after stability"', () => {
    const c: Change = { kind: 'version-changed', id, name: 'X', from: '1', to: '2' };
    expect(classifySeverity(c, ctx([ext()], {}))).toBe('info');
  });
```

- [ ] **Step 4: Run the full unit suite**

Run: `npm test`
Expected: all pass (every pin documents already-correct behavior; a failing pin means a real regression — stop and investigate, do not adjust the pin).

- [ ] **Step 5: Commit**

```bash
git add src/scoring/scoring.test.ts src/storage/storage.test.ts src/guardian/guardian.test.ts
git commit -m "test: backfill regression pins (installType bumps, updateUrl-inert scoring, migrate downgrade guard, no-history version bump)"
```

---

### Task 10: E2E backfill

**Files:**
- Test: `e2e/popup.spec.ts` (untrust flow — the trust test pattern at ~line 124 is the model)
- Test: `e2e/options.spec.ts` (monitoring off→on; cadence default — use the file's existing `optionsUrl`, `ALARM`, `swEval`, `getSettings` helpers)

- [ ] **Step 1: Untrust flow** — append in `e2e/popup.spec.ts` (reuse the file's existing URL helper and imports):

```ts
test('untrust returns a trusted extension to the graded report', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup/index.html`);
  const id = await page.locator('article.card').first().getAttribute('data-ext');
  await page.locator(`article.card[data-ext="${id}"] button[data-action="trust"]`).click();
  await expect(page.locator(`.trusted-section [data-ext="${id}"]`)).toHaveCount(1);
  await page.locator(`.trusted-section [data-ext="${id}"] button[data-action="untrust"]`).click();
  await expect(page.locator(`article.card[data-ext="${id}"]`)).toHaveCount(1);
  await expect
    .poll(() => swEval<string[]>(context, async () => (await chrome.storage.local.get('trusted')).trusted ?? []))
    .not.toContain(id);
  await page.close();
});
```

(If `e2e/popup.spec.ts` defines a `popupUrl(extensionId)` helper, use it instead of the inline template string — match the file's existing style.)

- [ ] **Step 2: Monitoring off→on + cadence default** — append in `e2e/options.spec.ts`:

```ts
test('monitoring off→on recreates the alarm', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(optionsUrl(extensionId));
  await page.locator('input[data-setting="monitoring"]').uncheck();
  await expect
    .poll(() => swEval<boolean>(context, async (name) => !(await chrome.alarms.get(name)), ALARM))
    .toBe(true);
  await page.locator('input[data-setting="monitoring"]').check();
  await expect
    .poll(() => swEval<number | null>(context, async (name) => {
      const a = await chrome.alarms.get(name);
      return a ? a.periodInMinutes ?? null : null;
    }, ALARM))
    .not.toBeNull();
  await page.close();
});

test('cadence select shows the 5-minute default on first open', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(optionsUrl(extensionId));
  await expect(page.locator('select[data-setting="cadence"]')).toHaveValue('5');
  await page.close();
});
```

- [ ] **Step 3: Run the E2E suite**

Run: `npm run test:e2e`
Expected: 20 passed (17 existing + 3 new). Note: signals themselves are unit-covered, not E2E-covered — the fixture extensions are store-less unpacked dirs with no `updateUrl`/`disabledReason`, so no signal can render for them; do not try to force one.

- [ ] **Step 4: Commit**

```bash
git add e2e/popup.spec.ts e2e/options.spec.ts
git commit -m "test(e2e): backfill untrust flow, monitoring off→on alarm recreation, cadence default"
```

---

### Task 11: v0.0.2 + docs + final verification

**Files:**
- Modify: `public/manifest.json` (`"version": "0.0.1"`)
- Modify: `package.json` (`"version": "0.0.1"`)
- Modify: `docs/ROADMAP.md` (phase table + queued section)
- Modify: `README.md` (engines description/diagram)

- [ ] **Step 1: Version bump** — in `public/manifest.json` and `package.json`, change `"version": "0.0.1"` → `"version": "0.0.2"` (the CWS requires a strictly higher version for the next upload).

- [ ] **Step 2: ROADMAP.** In `docs/ROADMAP.md`:
  1. Add a row to the Phases table after the 9.6 row:

```markdown
| **9.7 — Signal pack** | Four declared-metadata **informational signals** in an unscored lane (pure `signals/` engine): Chrome's own `permissions_increase` disable (new high-severity `disabled-for-permissions` Change + state note), `name-changed` Change (info), non-store update source, shared-update-host cluster — plus F-01 (atomic snapshot+timestamps write), F-02 (awaited `alarms.create`), and the test backfill. Research-revised scope: *event-driven version detection dropped — already built* (`chrome.management` has no `onUpdated` event; baseline-diff on `onInstalled` is the documented ceiling), and the updateUrl signals are provenance context, not detectors (the 2026 ownership-transfer and 108-extension campaigns shipped via the normal CWS channel). | ✅ |
```

  2. In the **"Queued — verified, constraint-clean, not yet scheduled"** section, replace the leading line of the net-new-signals bullet (`- **Net-new declared-metadata signals (ship informational):**`) with:

```markdown
- ~~**Net-new declared-metadata signals (ship informational)**~~ → **shipped as Phase 9.7** (see the
  phase table; event-driven version detection was found already-built during design research):
```

  3. In the **"Test backfill batch"** bullet of the same section, append ` → **shipped in Phase 9.7.**` at the end.

- [ ] **Step 3: README.** Read `README.md`, find the engines/architecture mermaid (the "four engines" diagram) and the engine list prose. Add a `signals/` node styled like the existing pure-engine nodes (e.g. `SIG["signals/ — informational lane"]`) with the same edge shape the other engines use into the report/popup flow, and add this sentence to the engines prose:

```markdown
A fourth-and-a-half engine, `signals/`, adds **unscored informational context** — non-store
update sources, shared update hosts, Chrome's own permissions-increase disables — in its own
muted lane, without ever touching the risk score.
```

(Adjust "four engines" phrasing to "five pure engines" if the README counts them explicitly.)

- [ ] **Step 4: Full verification gate**

Run: `npm run typecheck && npm test && npm run verify:build && npm run test:e2e`
Expected: tsc silent · all unit tests pass · `check-dist: OK` (4-permission invariant intact — this pack adds none) · 20 E2E pass.

- [ ] **Step 5: Commit**

```bash
git add public/manifest.json package.json docs/ROADMAP.md README.md
git commit -m "chore: v0.0.2 — signal pack shipped; roadmap + readme reflect the informational lane"
```

---

## After all tasks

Dispatch the final whole-branch code review, then use **superpowers:finishing-a-development-branch**: fast-forward merge `signal-pack` → `main`, push (plain author, no trailer). Do **not** upload a new CWS zip — v0.0.1 is mid-review; v0.0.2 uploads only after the owner decides, post-approval.
