# Ext-Ray — Trusted Extensions Design (Phase 9.6)

- **Date:** 2026-06-11
- **Status:** Approved design, pre-implementation
- **Elaborates:** main design spec §5.1/§5.4/§5.6; supersedes the current "ignore list" semantics.

## 1. Summary

Let the user mark a known-good extension (e.g. a real antivirus that legitimately needs broad
permissions) as **Trusted** directly from its popup card. A trusted extension is collapsed into a
"Trusted" section and **excluded from the A–F fleet grade** (shown transparently in the header), so
it stops driving the scary headline — but the background guardian **keeps watching it and
automatically revokes trust + alerts the instant it materially changes** (a new permission, host
expansion, publisher change, or a version bump after long stability).

This replaces today's `ignored` list, which is a **full-mute** (the guardian drops *all* changes for
an ignored id) — the anti-pattern industry tools converged away from, because it hides exactly the
silent-update supply-chain attack Ext-Ray exists to catch. The new behavior follows the
"acknowledge/snooze with re-alert on change" pattern used by AWS Security Hub (resets SUPPRESSED→NEW
on status worsening), Snyk ("ignore until fix"), and Tenable/Dependency-Track.

## 2. Decisions (owner-approved 2026-06-11)

1. **One unified "Trusted" concept**, replacing the `ignored` list (storage key + functions renamed;
   v1→v2 migration copies `ignored`→`trusted`). No second overlapping list.
2. **Grade impact: trusted extensions are EXCLUDED from the grade**, shown transparently in the
   header (`… · N trusted (excluded)`), preventing a false sense of safety while relieving fatigue.
3. **Trust auto-revokes on any MATERIAL change** (severity `notable` or `high`), which also fires the
   normal change notification. Non-material (`info`) churn for a trusted extension stays silent.
4. **Trust is set/cleared from the popup card** (in-context) and visible/manageable in the Trusted
   section + the options page.

## 3. Architecture (pure-core decides, edges do I/O — the codebase's split)

### 3.1 Storage (`src/storage/storage.ts`)
- Rename key `ignored` → `trusted`; `getIgnored`/`setIgnored` → `getTrusted`/`setTrusted`.
- `SCHEMA_VERSION` 1 → 2. `migrate()` gains a v1→v2 step: if an `ignored` value exists, write it to
  `trusted` and `chrome.storage.local.remove('ignored')`. Idempotent. (One-time, on-device; old
  "ignore" choices carry over as "trust" — the closest-meaning migration.)

### 3.2 Guardian core (`src/guardian/guardian.ts`, pure)
- `ScanInput.ignored` → `ScanInput.trusted`. `ScanResult` gains `revokeTrust: string[]`.
- New `evaluateScan` logic (replaces the `!ignoredSet.has` pre-filter):
  - Classify **all** changes (do not pre-drop trusted).
  - A change is **trust-voiding** iff its `severity !== 'info'` (i.e. `notable`/`high`: permission
    add, host expansion, publisher change, post-stability version bump). This reuses the existing
    `classifySeverity` — no new severity logic.
  - For a **trusted** id: drop `info` changes from `classified`; **keep** trust-voiding changes (they
    alert) and add the id to `revokeTrust`.
  - For a **non-trusted** id: unchanged (all changes classified; `noteworthy = severity !== 'info'`).
  - `notification` built from `noteworthy` exactly as today.
- Net effect: trusting silences benign churn but a real silent-update still alerts AND un-trusts the
  extension (so it reappears as its true tier next scan). The full-mute blind spot is eliminated.

### 3.3 Report core (`src/report/report.ts`, pure)
- Signature: `buildReport(snapshots: ExtSnapshot[], trusted: string[] = []): ReportView`.
- Partition: a snapshot whose id ∈ `trusted` → `trusted[]` (regardless of tier); else by tier into
  `risky`/`low` as today.
- **Grade computed over NON-trusted verdicts only** (`gradeFleet(nonTrusted.map(v))`). All-trusted →
  `gradeFleet([])` → `{ grade: 'A', score: 0 }` (honest only because the header shows the trusted
  count).
- `ReportView` gains `trusted: ReportCard[]` (full card shape: tier/score/reasons/icon so the user
  can review what they trusted, worst-first). `counts` gains `trusted: number`.
- Invariant: `risky.length + low.length + trusted.length === snapshots.length`.

### 3.4 Types (`src/types.ts`)
- `ScanInput.ignored` → `trusted`. `ScanResult` += `revokeTrust: string[]`.
- `ReportView` += `trusted: ReportCard[]`; `counts` += `trusted: number`.

### 3.5 Service worker (`src/background/index.ts`, glue)
- `getIgnored` → `getTrusted`; pass `trusted` into `evaluateScan`.
- After evaluate: if `result.revokeTrust.length`, compute `next = trusted.filter(id ∉ revokeSet)` and
  persist it in the same `Promise.all` as snapshot/timestamps. Trace `sec.guardian` 'trust revoked'.

### 3.6 Popup (`popup/render.ts` + `popup/index.ts`)
- `renderReport` (render.ts): header summary appends `· ${counts.trusted} trusted (excluded)` only
  when `counts.trusted > 0`. After the low-section, render a collapsed **Trusted** `section.trusted-section`
  (`h2.trusted-title` "Trusted") of the trusted cards; each shows icon/name/tier and an **Untrust**
  button (`data-action="untrust"`). Risky cards gain a **Trust** button (`data-action="trust"`) in
  their `.actions` (alongside Disable/Remove). Low rows unchanged.
- `popup/index.ts` (controller): import `getTrusted`/`setTrusted`; `load()` reads trusted and passes
  it to `buildReport`. Delegated click handles `data-action="trust"`/`"untrust"`: read trusted, add/
  remove the id, `setTrusted`, then re-run `load()` (full re-render — simplest correct update).
- All existing selectors (`.grade`, `.tier-label`, `article.card.tier-*`, `[data-action]`,
  `.low-section`, `footer.limits`) preserved.

### 3.7 Options (`options/render.ts` + `options/index.ts`)
- Section title "Ignore alerts from" → **"Trusted (alerts only if they change)"**; row attribute
  `data-ignore` → `data-trust`; param `ignored` → `trusted`. Controller: `getIgnored/setIgnored` →
  `getTrusted/setTrusted`; handler reads `data-trust`.

## 4. Testing (TDD for the pure cores)
- **guardian.test.ts:** rename `ignored`→`trusted` in fixtures; ADD: trusted id + `info` change →
  suppressed, `revokeTrust` empty; trusted id + `permissions-added` (host) → notification fires AND
  `revokeTrust` contains the id; non-trusted behavior unchanged.
- **report.test.ts:** trusted id → in `trusted[]`, absent from `risky`/`low`, excluded from grade;
  `counts.trusted` correct; all-trusted fleet → grade `A` + `counts.trusted === total`; invariant holds.
- **storage:** migrate v1→v2 renames `ignored`→`trusted` and removes the old key (seed via the fake
  chrome store).
- **e2e:** options spec — update `data-ignore`→`data-trust` and the `'ignored'`→`'trusted'` storage
  assertion. popup spec — existing assertions stay green (default `trusted=[]` ⇒ summary unchanged);
  ADD: click a risky card's Trust button → it leaves the risky cards, appears under
  `.trusted-section`, header shows "1 trusted (excluded)", and `chrome.storage.local.get('trusted')`
  contains its id.
- `npm run verify:build` (4-permission invariant unaffected — no new permission).

## 5. Scope / non-goals
No new permission. No change to scoring weights, `snapshot/diff`, or the alarm engine. The
threat-model finding F-01 (non-atomic multi-key write) is **not** addressed here (separate). Trust is
per-extension-id and local-only like all other state. Low rows do not get a Trust button (they are
already quiet); trusting is offered where the fatigue is — on risky cards.
