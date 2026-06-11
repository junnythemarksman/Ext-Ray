# Ext-Ray — Roadmap

Phased plan for building Ext-Ray, grounded in the
[design spec](dev/specs/2026-06-05-ext-ray-design.md) (§5 components → §6 data
flow → §9 testing → §10 distribution). One phase, one coherent slice of the product.

**Legend:** ✅ complete · ◀ current · ⬜ to do

## Phases

| Phase | Scope | Status |
|---|---|---|
| **0 — Design & research validation** | Design spec, README + Mermaid diagrams, adversarial design validation, 2022–26 literature/threat-intel validation (spec §13) | ✅ |
| **1 — Scaffold, tooling & trace layer** | TS + Vite + Vitest, MV3 manifest (4 non-host permissions), shared types, `debug.ts` trace layer (`sec`/`perf`/`calc`, zero-cost off) | ✅ |
| **2 — Pure engines (TDD)** | `scoring/` (`scoreExtension` + `gradeFleet`, owner-endorsed weights) and `snapshot/` (`diff`, 6 Change kinds, first-run invariant) | ✅ |
| **3 — Persistence (`storage/`)** | Typed `chrome.storage.local` wrapper (local-only by design): last snapshot, settings, per-extension `firstSeen`/`lastVersionChange` timestamps, ignore list; `schemaVersion` + `migrate()` seam | ✅ |
| **4 — Background guardian** | Service worker: synchronous top-level listeners incl. `onEnabled`/`onDisabled`/`onUninstalled` (**C2**), self-healing alarm, scan → score + diff → notify; **severity classification** (host/match-pattern expansion = high-confidence re-approval signal) + the **"version bump after long stability"** temporal signal; surface `getPermissionWarningsById` browser-authored warnings (**C1** — deferred to Phase 6 display) (spec §5.4, §4.5) | ✅ |
| **5 — MV3 build pipeline** | Hand-rolled two-pass Vite build (zero new deps) → loadable `dist/`: self-contained SW pass + pages pass, `public/` copies manifest + placeholder icons, `base: './'` relative assets, `check-dist.mjs` asserts the loadable contract. SW `iconUrl` uses `chrome.runtime.getURL()`. | ✅ |
| **6 — Popup report UI** | On-demand audit: A–F grade header, full cards for risky extensions (reasons + C1 browser warning + version + Disable/Remove), compact rows for low-risk, honest-limits footer. Pure `report/buildReport` + dumb `render` + thin `management` actions (`getPermissionWarningsById`/`setEnabled`/`uninstall`). Vanilla TS+CSS, `popup/` now type-checked. **Deferred to a follow-up:** `chrome.notifications.onClicked` → `openPopup()` wiring (touches the SW; `openPopup` has reliability caveats). | ✅ |
| **7 — Options / settings UI** | Settings page: monitoring toggle, preset cadence dropdown (1/5/15/30/60), notify toggle, per-extension ignore toggles — auto-saved to `storage/`. Pure `reconcileAlarm` (≥0.5 clamp) + SW `storage.onChanged` reconcile makes changes take effect **live** (monitoring-off clears the alarm; cadence change recreates it). `options/` now type-checked. | ✅ |
| **8 — Integration & in-browser E2E** | Playwright: load unpacked in Chrome/Edge, exercise every control, watch `console.error`/`pageerror`, screenshot on failure. **Deferred guardian/UI robustness cases land here:** (a) SW terminal unhandled-rejection if the final queued scan fails; (b) notify-before-persist kill window (could re-notify once); (c) `notifications.create` rejecting when the icon asset is absent; (d) the deferred `notifications.onClicked` → `openPopup()` wiring; (e) confirm the managed-state (no buttons) + options 420px width read well in-browser. | ✅ |
| **9 — Store-listing readiness** | Privacy policy + Limited Use disclosure (finalized in the public `ext-ray-privacy` repo, GitHub Pages), first-run **onboarding page** opened once on install (pre-empts the `management` warning; no new permission), `npm run shots` (behavior-matching 1280×800 store screenshots), `docs/store/` (listing copy + dashboard answers, trademark clear-but-provisional verdict, owner-only submission checklist) (spec §10) | ✅ |
| **9.5 — UI refresh** | Brand restyle of all three surfaces: shared OKLCH token system (`shared/tokens.css`), SVG ring gauge (`role=meter`, grade-mapped arc, word labels A Excellent → F At Risk), risk pills, **real extension icons** via `ExtensionInfo.icons` (research-verified, zero new permissions, pure `pickBestIcon` + fallback silhouette), WCAG 2.2 AA contrast/focus/forced-colors/reduced-motion gates. E2E selector contract preserved; product now matches the store screenshots + promo art. | ✅ |
| **9.6 — Trusted extensions** | Per-extension **Trust** (set from the popup card): trusted extensions collapse into a "Trusted" section and are **excluded from the A–F grade** (shown transparently in the header), but the guardian keeps watching and **auto-revokes trust + re-alerts on any material change** (`notable`/`high`). Replaces the prior full-mute ignore list (storage `ignored`→`trusted`, v2 migration), remediating the threat-model concern that ignoring an extension hid even a malicious update. Pure-core (`guardian` `revokeTrust`, `report` partition + grade-exclude); follows the snooze-with-re-alert pattern (AWS Security Hub / Snyk). | ✅ |
| **9.7 — Signal pack** | Four declared-metadata **informational signals** in an unscored lane (pure `signals/` engine): Chrome's own `permissions_increase` disable (new high-severity `disabled-for-permissions` Change + state note), `name-changed` Change (info), non-store update source, shared-update-host cluster — plus F-01 (atomic snapshot+timestamps write), F-02 (awaited `alarms.create`), and the test backfill. Research-revised scope: *event-driven version detection dropped — already built* (`chrome.management` has no `onUpdated` event; baseline-diff on `onInstalled` is the documented ceiling), and the updateUrl signals are provenance context, not detectors (the 2026 ownership-transfer and 108-extension campaigns shipped via the normal CWS channel). | ✅ |
| **10 — On-device AI explanations** *(progressive enhancement, built last)* | Chrome built-in AI (Prompt + Summarizer, Gemini Nano) for local plain-English risk explanations, layered **over C1** with graceful degradation when unavailable; honest disclosure of the one-time model download + hardware gates (**C3**); feature-gate Chrome 148 `responseConstraint` structured output (delta pass 2026-06-11) | ◀ **next** |

## Where we are

**Phases 9–9.6 complete — Ext-Ray is submission-ready with the brand UI** (101 unit +
**17 in-browser E2E**, `tsc`-clean, `verify:build` OK; the 9.5 restyle landed after the
store-readiness work below). Everything the repo can deliver for a Chrome Web Store listing now exists:
a first-run **onboarding page** opened once per install (`onInstalled` reason guard; `tabs.create`
needs no permission, so the check-dist 4-permission trust invariant still holds) that pre-empts the
"Manage your apps, extensions, and themes" warning with read-only / 100 %-on-device / why-management
reassurances + the privacy-policy link; **`npm run shots`** generating behavior-matching 1280×800
store screenshots from the real UI over a varied fixture fleet; and **`docs/store/`** — paste-ready
listing copy + Privacy-Practices dashboard answers, the trademark **clear-but-provisional** verdict,
and the owner-only submission checklist (2SV, trader status, create `extray.support@gmail.com`,
enable GitHub Pages on `ext-ray-privacy`, test-the-exact-ZIP, manual-review/backlog expectations,
one-appeal rule). The privacy policy itself is finalized in the public **`ext-ray-privacy`** repo.
**What remains for a live listing is owner-external only** (accounts, hosting toggle, upload).

**Phase 10 (on-device AI explanations) is next**, with the queued post-Phase-9 **signal pack**
(five evidence-backed declared-metadata signals + test backfill — see the audit/delta sections)
available as a small phase before or after it.

Honest limits carried through the E2E suite (Phase 8 spec §7): the native uninstall dialog can't be
driven by Playwright (Remove is verified by a narrow page-side spy — the one sanctioned mock); a
real notification click isn't automatable; screenshots are generated against an unpacked fixture
fleet, so they carry the documented `installType: development` tier bump the owner reviews before
upload.

The architectural arc: Phases 2–3 were pure/near-pure and unit-tested; Phase 4 added the `chrome.*`
guardian glue; Phase 5 made it loadable; Phases 6–7 built the user-facing UI; Phase 8 exercised the
whole thing in a real browser; Phase 9 packaged it for the store.

## Deferred — evidence-gated (design spec §13.2)

In-scope but parked until evidence justifies the false-positive cost:
- Composite `scripting` + broad-host capability flag (label "common in legitimate tools").
- Per-axis score decomposition in the report (host breadth as its own axis).
- "Republished under a new name" identity-churn heuristic.
- ~~`updateUrl`-anomaly on first scan.~~ **Evidence arrived (2026-06-11) → promoted to the queued
  signal pack** (see the delta pass below): the Feb–Mar 2026 ownership-transfer attacks
  (QuickLens/ShotBird) rotated `updateUrl` to attacker infrastructure post-sale.
- Optional `enabled-changed` Change kind — flag a *silent re-enable* of a disabled extension (low signal; enable/disable is normally user-driven, and the guardian already re-scans on `onEnabled`/`onDisabled`).

## Candidate enhancements (research-sourced)

From a 2024–2026 research pass (Chrome/MDN/W3C primary docs + peer-reviewed arXiv; claims
adversarially verified). Tag: **(A)** fits the hard constraints as-is · **(B)** needs a
non-goal relaxed · **(C)** out of scope.

| # | Enhancement | Tag | Lands in | Source (year) |
|---|---|---|---|---|
| **C1** | **Use `chrome.management.getPermissionWarningsById(id)`** — surface the *browser's own* human-readable permission warnings per extension. Free plain-English risk text, no model, within the `management` permission we already hold. **We were missing this.** | A | **Phase 4 ✅ adopted** | [Chrome mgmt API](https://developer.chrome.com/docs/extensions/reference/api/management) (2025) |
| **C2** | **Add push events `onEnabled` / `onDisabled` / `onUninstalled`** (alongside the planned `onInstalled`) — catch inter-poll state changes for the guardian; no new permission. | A | **Phase 4 ✅ adopted** | [Chrome mgmt API](https://developer.chrome.com/docs/extensions/reference/api/management) (2025) |
| **C3** | **On-device plain-English explanations via Chrome built-in AI** (Prompt API + Summarizer API, Gemini Nano) — stable for *extensions* since Chrome 138, CPU inference since Chrome 140; runs fully on-device, nothing leaves after a one-time model download. A *progressive enhancement* that degrades to C1 when unavailable. | A\* | **Phase 10 ✅ adopted** | [Chrome AI](https://developer.chrome.com/docs/ai/prompt-api) (2025) |
| **C4** | **Hold the line: transparency / diff / explanation, NOT a malware classifier.** Metadata-only ML hits ~98% in lab but ~54% *false-negatives* on new malware (concept drift); a bundled static classifier would silently rot. Reinforces our honest-limits stance. | A (framing) | spec §13 / Phase 6 | [arXiv 2509.21590](https://arxiv.org/html/2509.21590) (2025) |
| **C5** | **"Republished under a new name" via declared-field similarity** — name edit-distance, icon-URL/hash, version-string and permission-set Jaccard across the installed fleet. Refines the deferred §13.2 identity-churn idea; full *code* clustering stays out of scope. | A (decl. fields) / B (code) | Phase 4 (later) | [arXiv 2406.12710](https://arxiv.org/html/2406.12710v1) (2024) |

**\* C3 caveat (honesty):** the one-time multi-GB Gemini Nano model download is the *single*
network event in the AI path — triggered by Chrome/the user, not Ext-Ray's code — and is gated
on desktop hardware (≥16 GB RAM, 4+ cores, ~22 GB free disk; no Android/iOS/ChromeOS). Ext-Ray
itself still makes zero network calls. We'd disclose the download plainly and keep **C1 as the
baseline**, with C3 layered on only when `LanguageModel`/`Summarizer` reports available.

**Adopted (2026-06-06):** C1 + C2 into Phase 4; C3 as Phase 10 (progressive enhancement, built
last). C4 is a framing principle, already reflected in the honest-limits disclosure (spec §13).
C5 remains deferred (§13.2).

### Research corrections — what NOT to build

- **Don't treat every permission-string delta as a Chrome "re-approval" event.** Only
  **host/match-pattern expansion** reliably triggers Chrome's re-prompt-and-disable; API
  permission-string changes do not reliably warn. Phase 4 severity should weight host-scope
  expansion as the high-confidence signal. [[Chrome permission warnings](https://developer.chrome.com/docs/extensions/develop/concepts/permission-warnings), 2025]
- **Don't weight raw permission COUNT as risk** (refuted 0-3) — capability is about *which*
  permissions, not how many. (Our scoring already keys off the max weight; the small breadth
  bump stays small.)
- **Don't build a bundled static ML classifier** (see C4) and **don't cite SimExt**
  (arXiv 2406.00374 — its metadata-only transferability was refuted 0-3).

### Unanswered — worth a follow-up pass

Two angles produced no verified claims this run: **(4)** new 2025–26 threat classes beyond
Cyberhaven / RedDirection / ShadyPanda and their locally-observable signals, and **(5)**
UX / risk-communication research for non-experts. The UX gap is the biggest open lever for
"appeal" and deserves its own focused pass before Phase 6.

## Candidate enhancements — research pass 3 (2026-06-08): trajectory + novel tech

**Trajectory: ✅ on the right track (more correct in 2025–26, not less).** The dominant threat is
the "time-bomb" supply-chain attack — extensions clean for 3–5+ years (earning Featured/Verified
badges) then weaponized by a single silent post-install update store review can't catch
(DarkSpectre ~8.8M browsers; ShadyPanda; RedDirection). A skeptic of static scoring (Push Security)
endorses our exact model: "monitoring changes over time… rather than scoring static attributes."
**Strategic correction:** lean *more* on the longitudinal diff + relative signals, *less* on
absolute permission-breadth (a static scorer drifts; minimal sets like `activeTab`+`scripting`+
`storage` are dangerous yet low-weight). Honest-limits is **evidence-backed** (56% of malicious
extensions retained capability under MV3) — keep it. [[Koi](https://www.koi.ai/blog/darkspectre-unmasking-the-threat-actor-behind-7-8-million-infected-browsers), [arXiv:2503.04292](https://arxiv.org/html/2503.04292v1), [Push Security](https://pushsecurity.com/blog/why-browser-extension-risk-scoring-wont-predict-your-next-breach) — 2025–26]

| # | Enhancement | Tag | Source (year) |
|---|---|---|---|
| **N1** | **On-device peer-group / permission-outlier analysis** — cluster the installed fleet by apparent function (name/description/type), flag extensions whose declared permissions/host scope deviate from functional peers. A *relative* signal orthogonal to the absolute scorer; catches over-privilege + function-mismatch (the DarkSpectre "video downloader requesting 28 conferencing domains" is statically visible in `hostPermissions` vs `name`). **Caveat:** best variant needs market data we can't fetch; on-device uses weaker local-text/type clustering, and a 10–40-extension fleet may be too small — **validate viability before committing.** | A | [Jana/Erlingsson/Ion arXiv:1510.07308](https://arxiv.org/abs/1510.07308); [Google 2017](https://security.googleblog.com/2017/07/identifying-intrusive-mobile-apps-using.html) |
| **N2** | **Treat `userScripts` as a uniquely high-risk permission** in the weight table — Chrome 138 (May 2025) gates it behind a dedicated per-extension "Allow User Scripts" toggle (default OFF); the browser itself singles out this MV3 remote-code exception. Declared presence is a cheap, high-signal flag (we'd see the declared perm, not the runtime toggle state). | A | [Chrome userScripts](https://developer.chrome.com/blog/chrome-userscript) (2025) |
| **N3** | **Gemini Nano for on-device functional categorization** (beyond plain-English explanation) — Prompt API stable since Chrome 138; the same local model can infer an extension's category to *seed* N1's clustering. Extends C3. | A\* | [Chrome AI](https://developer.chrome.com/docs/ai/prompt-api) (2025) |
| **N4** | **Runtime host-access framing** — `addHostAccessRequest()` (Jan 2025) moved host grants to runtime. `chrome.management.hostPermissions` already reports the *granted* set (good — we don't overstate), but the honest-limits copy should note host access can change between scans (the guardian catches it). | A (framing) | [Chrome permissions API](https://developer.chrome.com/docs/extensions/reference/api/permissions) (2025) |

**Track, not adopt:** **Verified Uploads** (RSA-signed CWS uploads, May 2025) is the ecosystem's
structural answer to this threat, but it's opt-in/server-side with no documented locally-observable
signal today — re-check the CWS listing/API surface before concluding it's unusable. **Refuted —
don't build on:** "minimal permissions carry no discriminative signal" (0-3); "declared metadata is
more evasion-robust than code analysis" (0-3).

**Adopt-next (recommended order):** N2 ✅ **adopted 2026-06-08** (`weights.ts` `userScripts: 0.9` +
regression test) → N1 (headline differentiator, after a
viability spike) → N3 (folds into Phase 10) → N4 (copy refinement). N1/N3 warrant their own brainstorm
→ spec → plan cycle; N2/N4 are small tunings.

## Phases 1–8 audit (2026-06-08, multi-agent review + research)

A comprehensive multi-pass review covered every Phase 1–8 subsystem and ran a fresh 2025–26 web/research pass,
then adversarially verified 45 of 84 candidates against the hard constraints and this roadmap
(14 adopt / 15 consider / 16 reject). **Verdict: Phases 1–8 are sound; the constraints hold; the
2025–26 campaigns (GlassWorm, Phantom Shuttle proxy-MitM, Unit 42 AI/debugger abuse) *validate* the
endorsed weights rather than challenge them** — so every "add a critical weight" idea was rejected as
redundant. The endorsed weight values remain frozen.

### Fixing now — Phase 8.5 hardening (verified small fixes)
- **F1 — `check-dist.mjs` enforces the trust invariant** (Phase 5): assert manifest `permissions` ==
  exactly `{management,storage,alarms,notifications}`, **no** `host_permissions`, no
  `externally_connectable`, and `background.type === 'module'`. Today the core trust signal has zero
  automated guard — a future network-permission edit would pass `verify:build` and ship silently.
- **F2 — guardian empty-`curr` guard** (Phase 4): a transient empty `getAll()` (SW/profile-init race)
  rebases the baseline to `[]`, laundering any change in that window into the "trusted" set. Add a pure
  guard (skip scan + no persist when `curr.length===0 && prev.length>0`) + unit test.
  *Trade-off (intended):* a genuine uninstall of **every** other extension also reads as empty and is
  skipped (baseline not updated) until one reappears — benign and self-healing (a removed extension
  can't act), and the safe choice vs. silently rebasing the baseline to `[]`.
- **F3 — scoring reason de-dup** (Phase 2): multiple weight-1.0 hosts (`<all_urls>` + `*://*/*`) emit
  the same "all websites" bullet twice on the card. `[...new Set(reasons)]` + regression test.
- **F4 — `file://` reason label** (Phase 2): `file://` patterns score 1.0 but are mislabeled "all
  websites" (honest-limits violation) → "Can read your local files" + fixture test.
- **F5 — `.is-disabled` at initial render** (Phase 6): already-disabled extensions render at full
  opacity until toggled; apply the class on first render in `renderCard`/`renderRow`.

### Queued — verified, constraint-clean, not yet scheduled
- ~~**Net-new declared-metadata signals (ship informational)**~~ → **shipped as Phase 9.7** (see the
  phase table; event-driven version detection was found already-built during design research):
  `disabledReason==='permissions_increase'`
  (zero-false-positive, Chrome-set, dominant 2025–26 footprint; [mgmt API](https://developer.chrome.com/docs/extensions/reference/api/management)) ·
  event-driven version detection via `management.onInstalled` + stored-version diff (closes the
  silent-update→next-scan window) · **`name-changed` Change kind** — the first concrete increment of
  the deferred **C5**, at informational severity — *now empirically grounded:* malicious developers
  churn identifying metadata significantly more than legitimate ones
  ([MADWeb/NDSS 2026](https://madweb.work/papers/2026/madweb26-paper27.pdf)) ·
  **non-CWS `updateUrl` flag** (promoted from §13.2, evidence 2026): an extension whose `updateUrl`
  isn't `clients2.google.com` self-hosts its updates — the ownership-transfer-attack footprint
  (QuickLens/ShotBird; [Hacker News, Mar 2026](https://thehackernews.com/2026/03/chrome-extension-turns-malicious-after.html));
  informational reason in scoring (the guardian already rates the *change* high) ·
  **shared-`updateUrl` cluster flag**: two-plus installed extensions sharing one non-CWS update
  domain = likely single operator (108-extension MaaS cluster;
  [Socket, Apr 2026](https://socket.dev/blog/108-chrome-ext-linked-to-data-exfil-session-theft-shared-c2));
  O(N) within the fleet from data already in `ExtSnapshot` — the first evidence-backed *relative*
  signal (lightweight cousin of N1).
- **Test backfill batch** (regression pins on already-correct, frozen-weight behavior): installType
  `other`/`admin`, single-extension `gradeFleet`, `updateUrl` edge cases, `migrate()` downgrade guard,
  `version-changed`-with-no-history, `reconcileAlarm` clamp idempotency; E2E un-ignore + monitoring
  off→on recreation + initial cadence default. → **shipped in Phase 9.7.**
- **Hygiene:** `refreshDebug()` + its mutable registry appear to be **dead code** (exported, never
  called; the "toggle logging without redeploy" path isn't wired end-to-end) — decide: wire a DEV-only
  hook or delete. Narrowing `ExtSnapshot.installType` to the `chrome.management` literal union is
  low-value (nothing reads `.type`).

### Delta pass (2026-06-11) — what changed since the audit

A follow-up review (repo delta + threat intel + platform + papers, Dec 2025–Jun 2026 window)
confirmed F1–F5 shipped intact and added the two `updateUrl` signals above. Other notes:
- **Calibration anchor:** ~16 % of CWS extensions (by install share) perform third-party tracking,
  and broad declared host patterns are predictive *without* runtime analysis
  ([AXECC, ACM TOPS Apr 2026](https://dl.acm.org/doi/10.1145/3805701)) — validates the scoring
  approach; if our high-risk flag rate is near that band, we're calibrated, not over-sensitive.
- **`chrome.management` gained no new fields/events through Chrome 148** — the queued
  `disabledReason` signal remains the freshest API surface.
- **Phase 10 planning note:** Chrome 148's Prompt API adds `responseConstraint` (JSON-schema
  structured output) + multimodal input; feature-gate it (extensions baseline is still Chrome 138)
  ([Chrome 148](https://developer.chrome.com/blog/new-in-chrome-148)).
- **Phase 9 process notes:** privacy policy is now set **per-item** in the dashboard; active CWS
  review backlog (budget 1–2+ weeks); team roles + private enterprise publishing now exist
  ([extensions I/O 2026](https://developer.chrome.com/blog/extensions-io-2026)).
- **Recommended packaging:** implement the five queued signals + test backfill as one small
  post-Phase-9 "signal pack" phase; nothing here blocks store readiness.

### Refuted — checked, do NOT build
- No re-adding `debugger`/`proxy`/`nativeMessaging`/`userScripts` weights (already present, frozen,
  and *validated* by 2025–26 campaigns). · No scored `DNR+scripting+broad-host` composite (already
  clamps to 1.0/critical). · No hard installType tier-floors (over-flags legit sideload/dev/IT). · No
  AI-brand-name keyword blocklist (spoofable, honest-limits violation). · No raw-permission-**count**
  risk (2025 sources: malware uses *fewer*, minimal sets — count is inversely correlated). · No
  bundled metadata ML classifier (~54% false-neg within months from concept drift, Rosenzweig et al.,
  ACM TWEB 2025 — use as honest-limits framing copy). · No cloud-AI/CWS-listing data (breaks
  local-only). · `web_accessible_resources` / `externally_connectable` / `chrome_settings_overrides` /
  CWS developer history are **not** exposed by `chrome.management` → genuinely out of scope.
