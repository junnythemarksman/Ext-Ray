# Ext-Ray — Design Spec

- **Date:** 2026-06-05
- **Status:** Approved design, pre-implementation
- **Author:** Genaro Peque, Jr
- **Type:** Browser extension (Chromium / Manifest V3), local-only

## 1. Summary

Ext-Ray is a local-only Chrome/Edge extension that audits the user's _other_ installed
extensions for security and privacy risk. It provides:

- an **on-demand report** — an overall security grade plus per-extension risk cards with
  plain-English reasons and one-click disable/uninstall; and
- a background **guardian** that alerts the user when an extension is newly installed or
  silently changes after install.

All analysis runs on-device. No backend, no accounts, no data leaves the browser.

## 2. Goal & success criteria

A genuinely useful, simple tool that helps individuals understand and reduce the risk of
the extensions they already run. **Success** = a user can, in one click, see which of their
extensions are risky and why, act on it, and be warned when something changes.
Defensibility and monetization are explicit non-goals (see §11 for the strategic context).

## 3. Non-goals (YAGNI)

- No backend, accounts, cloud, or telemetry.
- No Firefox/Safari (different APIs) — Chromium (Chrome + Edge) only.
- No enforcement/blocking beyond user-initiated disable/uninstall.
- No malicious-extension threat database or reputation feed.
- No code/network behavioral analysis. Ext-Ray reads _declared_ permissions and install
  state, **not** the JS payload. This boundary is stated honestly in the UI.

## 4. Key decisions (validated)

A two-pass adversarial validation (see §11) confirmed technical feasibility and corrected
the guardian design.

1. **Permissions: exactly four, all non-host** — `management`, `storage`, `alarms`,
   `notifications`. No host permissions, no `<all_urls>`, no page/content access. Confirmed
   against the Chrome permissions reference as the complete set required. This minimal
   footprint is the product's core trust signal.
2. **Stack:** vanilla TypeScript + Vite, minimal dependencies. A security tool should not
   ship a large transitive dependency tree (supply-chain hygiene).
3. **Data source:** `chrome.management.getAll()` returns per-extension `id, name, version,
   enabled, type, installType, permissions, hostPermissions, mayDisable, updateUrl, icons`
   — exactly the fields the scoring model needs. Confirmed against Chromium `management.json`.
4. **Change detection uses both mechanisms:**
   - `chrome.management.onInstalled` — confirmed in Chromium source
     (`management_api.cc`, `OnExtensionInstalled(..., is_update)`) to fire on third-party
     **updates** as well as installs, delivering the updated `ExtensionInfo` (incl.
     permissions). Used as a low-latency trigger.
   - `chrome.alarms` periodic re-scan + snapshot diff in `chrome.storage.local` — the
     robust baseline. `onInstalled` carries no install-vs-update flag, so a stored-snapshot
     diff is required regardless. Minimum alarm period is 30s (Chrome 120+); a cadence of a
     few minutes is ample here.
   - The alarm is **self-healing**: on every service-worker startup, check
     `chrome.alarms.get` and recreate if missing (alarms may be cleared on browser restart).
     All event listeners are registered **synchronously at the top level** of the service
     worker so events are not missed.
5. **Guardian semantics (corrected by validation):** alert on **any meaningful silent
   change after install**, not just "gained a scary permission." The largest real-world
   2024–25 extension attacks (Cyberhaven/Sekoia ~2.6M users, RedDirection 2.3M, ShadyPanda
   4.3M) added **no** new permissions — they injected code into already-broad permissions.
   So the guardian fires on: new install, declared-permission delta (including Chrome-silent
   ones), version bump after long stability (the "clean for months, suddenly updated"
   temporal anomaly that preceded those attacks), and publisher/`updateUrl` change. The UI
   states plainly that Ext-Ray detects declared-permission and install-state risk, not
   code/network malice.

## 5. Architecture & components

Each unit has one purpose, a well-defined interface, and is testable in isolation. The two
core engines are **pure** (no I/O) so the messy `chrome.*` surface stays at the edges.

### 5.1 `scoring/` — risk engine (pure)

- **Purpose:** turn one extension's metadata into a risk verdict.
- **Interface:**
  `scoreExtension(info: ExtSnapshot): Verdict`, where
  `Verdict = { tier: 'critical' | 'high' | 'medium' | 'low', score: number /* [0,1] */, reasons: string[] }`;
  plus `gradeFleet(verdicts: Verdict[]): { grade: 'A'|'B'|'C'|'D'|'F', score: number }`.
- **Logic:** a permission→risk-weight table; an install-source modifier
  (`development`/`sideload` bump risk; `admin`/policy noted); an enabled-state factor. The
  fleet grade is **worst-case-weighted** (a single critical extension must not be hidden by
  many safe ones), normalized to `[0, 1]`.
- **Bounds (documented in code):** score ∈ `[0, 1]`; monotonic in permission danger;
  aggregate ≥ max single risk; deterministic; no NaN/overflow.
- **Deps:** none.
- _The permission→tier table is the one place domain judgment shapes product feel; it will
  be authored deliberately during implementation._

### 5.2 `snapshot/` — diff engine (pure)

- **Purpose:** detect what changed between two scans.
- **Interface:** `diff(prev: ExtSnapshot[], curr: ExtSnapshot[]): Change[]`, where each
  `Change` is one of `installed | removed | permissions-added | permissions-removed |
  version-changed | publisher-changed`, carrying the extension id + relevant detail.
- **Deps:** none.

### 5.3 `storage/` — persistence (thin async wrapper)

- **Purpose:** isolate `chrome.storage.local` access behind a typed interface.
- **Interface:** get/set for: last snapshot; settings; per-extension first-seen and
  last-version-change timestamps; and the user's ignore/acknowledge list.
- **Deps:** `chrome.storage`.

### 5.4 `background/` — service worker (glue)

- **Purpose:** wire events → scan → score + diff → notify.
- **Behavior:** on an `onInstalled` event OR an `alarms` tick → `getAll()` → normalize →
  `scoreExtension` + `diff` against the stored snapshot → `chrome.notifications` on
  meaningful changes → persist the new snapshot. Self-healing alarm; synchronous listener
  registration.
- **Deps:** `chrome.management`, `chrome.alarms`, `chrome.notifications`, `scoring/`,
  `snapshot/`, `storage/`.

### 5.5 `popup/` — report UI

- **Purpose:** the on-demand audit.
- **Behavior:** on open → `getAll()` → filter (`type === 'extension'`, exclude self) →
  `scoreExtension` per item → render the overall grade + risk cards sorted worst-first,
  each with plain-English reasons and **Disable** / **Remove**. Actions are gated on
  `mayDisable` (greyed + "managed by your organization" when false); `uninstall` uses
  Chrome's native confirmation dialog so the user stays in control.
- **Deps:** `chrome.management`, `scoring/`.

### 5.6 `options/` — settings

- **Purpose:** configure the guardian.
- **Behavior:** toggle background monitoring, scan cadence, notification preferences, and
  manage the ignore-list.
- **Deps:** `storage/`.

## 6. Data flow

- **Audit (popup):** open → `getAll()` → filter → `scoreExtension` per item →
  `gradeFleet` → render. Refresh snapshot + first-seen timestamps.
- **Guardian (background):** `onInstalled` | `alarms` tick → `getAll()` →
  `scoreExtension` + `diff(prevSnapshot, current)` → notify on meaningful `Change`s →
  persist snapshot.

## 7. Shared types

`ExtSnapshot = { id, name, version, enabled, type, installType, permissions: string[],
hostPermissions: string[], mayDisable, updateUrl }` — the normalized projection of
`chrome.management.ExtensionInfo` that both engines consume. This keeps the pure engines
decoupled from the raw API shape.

## 8. Error handling (boundaries only)

Trust internal invariants; validate only at the `chrome.*` boundary:

- `getAll()` empty/unavailable → graceful empty state, no crash.
- Filter out themes/apps (`type !== 'extension'`) and Ext-Ray itself.
- `mayDisable === false` → action disabled in the UI (never let `setEnabled`/`uninstall`
  reject at runtime).
- Snapshot absent on first run → treat all as first-seen, emit **no** spurious "changed"
  alerts.

## 9. Testing (TDD)

Test-first on the two pure engines before any glue:

- **Scoring fixtures:** zero-permission → low; `<all_urls>` / `*://*/*` → critical;
  sideloaded narrow → bumped; theme → excluded; mixed fleet → expected grade.
- **Diff fixtures:** added permission → `permissions-added`; version-only bump →
  `version-changed`; new id → `installed`; removed id → `removed`; `updateUrl` change →
  `publisher-changed`.
- `chrome.*` is mocked for engine tests; service-worker wiring is integration-tested
  separately.

## 10. Naming & distribution

- The name **Ext-Ray** was verified clear on the Chrome Web Store with no surfaced
  trademark. Soft caveat: a 2017 academic tool "Ex-Ray" is one letter off in the same niche
  (a research paper, not a product/mark — not a blocker). A formal USPTO search is advised
  before any public listing.
- Requesting the `management` permission triggers heightened Web Store review and a
  "Manage your apps, extensions, and themes" install warning. The listing and first-run
  screen will pre-empt it: read-only, never disables anything without a click, nothing
  leaves the device. A privacy policy + Limited Use disclosure will accompany the listing
  even though no data is transmitted.

## 11. Provenance (why this shape)

This design is the output of a brainstorming + two-pass adversarial validation session:

- A _consumer auditor_ and a _B2B small-team_ variant were both validated and returned
  "reconsider" **as businesses** — the category is commoditized for free by Chrome's native
  Safety Check / Chrome Enterprise Core and by funded competitors (e.g. Push Security).
- The goal here is a **genuinely useful tool, not a defensible business**, so those verdicts
  are non-binding. The validation's lasting value: it **technically de-risked every API**
  this depends on, and it **corrected the guardian** away from permission-diff-only (which
  would have missed the biggest real attacks) toward any-silent-change detection.

## 12. Open questions / future

- Exact permission→tier weights (authored during implementation).
- Staleness/abandonment signal: `chrome.management` has no "last updated" field; Ext-Ray
  approximates via self-tracked version-change timestamps over time.
- Possible later: export a local "security report card"; an Edge-specific smoke test.
