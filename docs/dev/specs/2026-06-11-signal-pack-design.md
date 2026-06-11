# Ext-Ray — Signal Pack Design (post-Phase-9, v0.0.2)

- **Date:** 2026-06-11
- **Status:** Approved design, pre-implementation
- **Elaborates:** main design spec §5.1/§5.2/§5.4; implements the "queued signal pack" from
  `docs/ROADMAP.md` (audit/delta sections), revised by a fresh research pass (below).

## 1. Summary

Add four declared-metadata **signals** — context the user can see, distinct from the scored risk
verdict — plus two small correctness fixes and a test backfill:

1. **Disabled-for-permissions** — Chrome auto-disabled an extension because an update requested
   more permissions (`disabledReason === 'permissions_increase'`). Surfaced two ways: a **high**
   severity guardian Change when the transition is observed (notification-worthy — Chrome itself
   confirmed an escalation attempt), and an informational state line on the popup card while the
   extension sits disabled.
2. **`name-changed`** — a new **info**-severity Change kind (identity churn; paper-backed, low
   recall acknowledged).
3. **Non-store update source** — an informational note when an extension's declared `updateUrl`
   points outside the official extension stores.
4. **Shared update host** — an informational note when ≥2 installed extensions share one
   non-store update host ("could be one developer or one operator" — never asserted further).

Signals **never affect the score**. The permission-risk score stays pure (frozen weights
untouched); signals render as a visually distinct muted lane on popup cards/rows. This is the
Amazon Inspector model — "Informational" is a weight-zero tier *below* low, reported but never
summed — and deliberately avoids CRXcavator's blend-everything-into-one-number design
(discontinued 2023).

Bundled: **F-01** (atomic snapshot+timestamps write) and **F-02** (await `alarms.create`) from the
threat model, plus the ROADMAP's **test backfill batch**.

## 2. Research basis (2026-06-11 pass; primary sources, currency-verified)

What the research **confirmed**:
- `ExtensionDisabledReason` is exactly `{unknown, permissions_increase}`; `updateUrl` and
  `installType` (`admin|development|normal|sideload|other`) are current `ExtensionInfo` fields.
  [Chrome management API reference, 2026]
- Canonical CWS update endpoint: `https://clients2.google.com/service/update2/crx`. An **absent**
  `updateUrl` is the *normal* CWS case — never a signal. [Chrome Enterprise docs, 2026]
- Gold-standard presentation: informational = weight 0, separate lane, fire only on uncommon
  states (Amazon Inspector severity model; Wiz alert-fatigue guidance, 2026).

What the research **corrected** (vs. the ROADMAP's original framing):
- **"Event-driven version detection" is already built.** `chrome.management` has no `onUpdated`
  event and `management.onInstalled` carries no `reason`/`previousVersion` (that is
  `runtime.onInstalled`, self-scoped only). The only documented path is baseline-diffing on a
  re-scan trigger — exactly what the SW already does (`management.onInstalled` → `scheduleScan()`
  → `diff()`). Dropped from the pack; ROADMAP documents why.
- **The updateUrl signals are provenance context, not detectors.** The 2026 QuickLens/ShotBird
  ownership-transfer attack shipped through the normal CWS channel (no updateUrl rotation), and
  the 108-extension Socket campaign was attributed via shared C2/OAuth — all CWS-hosted. Neither
  flagship campaign would be caught by these signals. They ship as informational only.
- **Name churn is low-recall.** Every documented major campaign *preserved* the name (trust
  retention); "republish under new name" arrives as a new id. `name-changed` ships at `info`,
  never alerts alone.
- The false-positive class for non-store updateUrl is legitimate enterprise/self-hosted
  (`installType 'admin'`) and development installs — the copy acknowledges the enterprise case.

## 3. Decisions (owner-approved 2026-06-11)

1. **Approach A**: a new pure `src/signals/` module consumed by `report/buildReport` (which already
   sees the whole fleet — required for the cluster signal). Scoring untouched.
2. **Severities:** `disabled-for-permissions` → `high` (same class as `permissions-added`;
   Chrome-confirmed). `name-changed` → `info`.
3. **Store-host allowlist covers both supported browsers:** `clients2.google.com` (CWS) **and**
   `edge.microsoft.com` (Edge Add-ons). Ext-Ray runs on Edge; allowlisting only CWS would flag a
   whole Edge fleet — the exact alert-fatigue failure the research warns against.
4. **No storage migration**: `ExtSnapshot.disabledReason` is optional/additive;
   `SCHEMA_VERSION` stays 2.
5. F-01 + F-02 bundled into this cycle; the low-severity threat-model rest stays parked.

## 4. Architecture (pure-core decides, edges do I/O)

### 4.1 Types (`src/types.ts`)
- `ExtSnapshot` gains `disabledReason?: string` (populated only when Chrome reports one;
  `'permissions_increase'` is the only actionable value — anything else reads as `unknown` and is
  ignored, per the two-value enum).
- `Change` union gains:
  - `{ kind: 'name-changed'; id: string; name: string; from: string; to: string }` (`name` = the
    current/post-rename name — every Change kind is self-describing)
  - `{ kind: 'disabled-for-permissions'; id: string; name: string }`
- `ReportCard` and `ReportRow` gain `signals: string[]` (informational, possibly empty).

### 4.2 Management edge (`src/management/management.ts`)
`normalize()` maps `e.disabledReason` through unchanged (optional). No other change.

### 4.3 Diff engine (`src/snapshot/snapshot.ts`)
Inside the existing per-extension loop:
- `before.name !== e.name` → emit `name-changed` (`from`/`to`).
- **Transition-guarded** disable signal: `before.enabled && !e.enabled &&
  e.disabledReason === 'permissions_increase'` → emit `disabled-for-permissions`.
  - The guard preserves the first-run/upgrade invariant: an extension *already* disabled at first
    sight (or when the `disabledReason` field first appears after Ext-Ray's own update — old
    stored snapshots lack the field but have `enabled`) emits **no** Change. Its *state* still
    surfaces via the signals lane (§4.5).

### 4.4 Guardian (`src/guardian/guardian.ts`)
Both switches are exhaustive — TypeScript forces the additions:
- `classifySeverity`: `'disabled-for-permissions'` → `'high'`; `'name-changed'` → `'info'`.
- `describeChange`: `'disabled-for-permissions'` → `` `${name} was disabled: its update requested
  more permissions` ``; `'name-changed'` → `` `“${from}” was renamed to “${to}”` `` (unreachable in
  notifications while `info`, but the switch must be total).
- Trusted interplay falls out of the existing rules: `disabled-for-permissions` on a trusted
  extension is material (`high`) → alerts **and** revokes trust; `name-changed` is `info` → silent
  for trusted, listed for others.

### 4.5 New pure module (`src/signals/signals.ts`)
~60 lines, no I/O, mirrors `scoring/`/`snapshot/` discipline. One exported function:

```ts
/** Informational, unscored signals per extension. O(N) over the fleet; deterministic.
 *  Codomain: each id maps to 0–3 short plain-English strings. Never affects any score. */
export function fleetSignals(snapshots: ExtSnapshot[]): Map<string, string[]>
```

- **Store hosts:** `const STORE_HOSTS = new Set(['clients2.google.com', 'edge.microsoft.com'])`.
- **Host extraction:** `new URL(updateUrl).hostname` in try/catch; a malformed URL (near-impossible
  from Chrome) safe-fails as non-store — over-noting, never under-noting (same philosophy as
  `hostWeight`).
- Signal strings (exact copy):
  1. disabled-state: `Chrome disabled this extension: an update requested more permissions` —
     when `!enabled && disabledReason === 'permissions_increase'`.
  2. non-store source: `Updates from outside the official extension store` — when `updateUrl` is
     present and its host ∉ STORE_HOSTS; with `installType === 'admin'` append
     ` (enterprise-managed installs commonly self-host)`. Absent `updateUrl` → nothing.
  3. shared host: `` `Updates from the same server (${host}) as ${n} other installed
     extension${n === 1 ? '' : 's'} — could be one developer or one operator` `` — for each member
     of a ≥2 group sharing one non-store host.

### 4.6 Report (`src/report/report.ts`)
`buildReport` calls `fleetSignals(snapshots)` once and threads `signals` into every card/row
(risky, low, trusted alike — a trusted extension's disabled-state signal still matters).
Sort/partition/grade logic untouched; the §invariant comment gains "signals are informational and
never affect tier/score/order."

### 4.7 Popup render (`popup/render.ts`)
After the `reason` paragraphs in `renderCard` (and equivalently in the low-row renderer): for each
signal, `el('p', 'signal', text)`. CSS: `.signal` — smaller type, `--muted` token color, `ℹ`
generated-content prefix; visually distinct from `.reason`. No new controls; E2E selector contract
unchanged (additive class only).

### 4.8 Bundled correctness fixes
- **F-01** (`storage.ts` + `background/index.ts`): add
  `setSnapshotAndTimestamps(snapshot, timestamps)` → one
  `chrome.storage.local.set({ snapshot, timestamps })` (single WriteBatch = atomic); `runScan`
  uses it instead of the two-promise `Promise.all`. The `setTrusted` write may stay separate
  (trust-revocation is not torn-state-coupled to the snapshot).
- **F-02** (`background/index.ts` `applyAlarmAction`): `await chrome.alarms.create(...)` —
  symmetric with the `clear` branch.

## 5. Testing (TDD; pure cores unit-tested, glue e2e-covered)

New unit tests:
- `snapshot.test.ts`: name-changed fires on rename; disabled-for-permissions fires on the real
  transition; **no** Change when already-disabled at first sight / when prev lacks
  `disabledReason` but ext was already disabled; no Change for `disabledReason: 'unknown'`.
- `guardian.test.ts`: severities (`high`/`info`); disabled-for-permissions revokes trust + alerts
  on a trusted extension; name-changed is silent for trusted.
- `signals.test.ts` (new): disabled-state string; non-store host flagged; `clients2.google.com`
  and `edge.microsoft.com` NOT flagged; absent `updateUrl` not flagged; admin suffix; malformed
  URL safe-fails to flagged; cluster of exactly 2 produces the shared-host string on both; three
  extensions on one host count `n = 2` each; store-host sharing never clusters.
- `report.test.ts`: signals threaded onto cards/rows/trusted; empty signals = empty array; grade
  unaffected by signals.
- `storage.test.ts`: `setSnapshotAndTimestamps` writes both keys in one `set` call.

ROADMAP backfill batch (regression pins on frozen behavior):
- `scoring.test.ts`: installType `other` (+0.1) and `admin` (+0) bumps; updateUrl ignored by
  scoring.
- `gradeFleet`: single-extension fleet (score === that extension's score).
- `storage.test.ts`: `migrate()` downgrade guard (stored version > SCHEMA_VERSION → no-op).
- `guardian.test.ts`: `version-changed` with no stored history → `info`.
- `alarm.test.ts`: `reconcileAlarm` clamp idempotency.
- E2E (`e2e/`): untrust flow returns the extension to the graded list; monitoring off→on recreates
  the alarm; options cadence shows the 5-minute default on first open.

## 6. Out of scope / honest limits (carried into copy where user-visible)

- **No score impact from any signal** — weights frozen, score = permission risk only.
- Ext-Ray **cannot see** developer/ownership changes, manifest `update_url` rotation post-install,
  runtime C2, or remotely fetched code — the mechanisms behind the dominant 2025–26 campaigns.
  Signals are context, not detection coverage; nothing in the UI may imply otherwise.
- `enabled-changed` as a general Change kind stays deferred (ROADMAP §13.2) — only the
  permissions_increase disable transition is signal-worthy.
- The MV3 manifest, permission set, and storage schema version are unchanged.

## 7. Docs

- `docs/ROADMAP.md`: signal pack row ✅ with the research deltas — explicitly including
  "event-driven version detection: already built (no `onUpdated` event exists; baseline-diff on
  `management.onInstalled` is the documented ceiling)".
- `README.md`: engines list/diagram gains `signals/` (informational lane), one sentence on the
  signals concept.
