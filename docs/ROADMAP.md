# Ext-Ray — Roadmap

Phased plan for building Ext-Ray, grounded in the
[design spec](superpowers/specs/2026-06-05-ext-ray-design.md) (§5 components → §6 data
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
| **7 — Options / settings UI** | Toggle monitoring, scan cadence, notification prefs, manage ignore-list (spec §5.6). Clamp `scanIntervalMinutes` ≥ 0.5 — Chrome 120+ won't honor a shorter alarm period. Widen `tsconfig` `include` to also type-check the real `options/` TS (Phase 6 widened it for `popup/`). | ◀ **next** |
| **8 — Integration & in-browser E2E** | Playwright: load unpacked in Chrome/Edge, exercise every control, watch `console.error`/`pageerror`, screenshot on failure. **Deferred Phase-4 guardian robustness cases land here:** (a) service-worker terminal unhandled-rejection if the final queued scan fails; (b) notify-before-persist kill window (could re-notify once); (c) `notifications.create` rejecting when the icon asset is absent. | ⬜ |
| **9 — Store-listing readiness** | Privacy policy + Limited Use disclosure, first-run screen pre-empting the `management` warning, USPTO trademark check (spec §10) | ⬜ |
| **10 — On-device AI explanations** *(progressive enhancement, built last)* | Chrome built-in AI (Prompt + Summarizer, Gemini Nano) for local plain-English risk explanations, layered **over C1** with graceful degradation when unavailable; honest disclosure of the one-time model download + hardware gates (**C3**) | ⬜ |

## Where we are

**Phase 6 complete** — the popup on-demand audit is built and merged to `main` (73 tests,
`tsc`-clean, `verify:build` OK): A–F grade, risky cards (reasons + C1 browser warnings + version +
Disable/Remove), low-risk rows, honest-limits footer — all on a pure `buildReport` + dumb render.
**Phase 7 (options / settings UI) is next** — the second UI surface: toggle monitoring, scan
cadence, notifications, and the ignore-list, persisted via the existing `storage/` layer.

Two small follow-ups carried forward: the `notifications.onClicked` → open-popup wiring (a SW
change with `openPopup()` caveats) and the managed-state UX (currently shows a note rather than
greyed buttons — an intentional simplification to confirm in Phase 8).

The architectural arc so far: Phases 2–3 were pure/near-pure and unit-tested; Phase 4 added the
`chrome.*` guardian glue; Phase 5 made it all loadable in a browser. From here (Phases 6–7) the
work is user-facing UI, then Phase 8 exercises the whole thing in a real browser.

## Deferred — evidence-gated (design spec §13.2)

In-scope but parked until evidence justifies the false-positive cost:
- Composite `scripting` + broad-host capability flag (label "common in legitimate tools").
- Per-axis score decomposition in the report (host breadth as its own axis).
- "Republished under a new name" identity-churn heuristic.
- `updateUrl`-anomaly on first scan.
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

**Adopt-next (recommended order):** N2 (cheap weight-table win) → N1 (headline differentiator, after a
viability spike) → N3 (folds into Phase 10) → N4 (copy refinement). N1/N3 warrant their own brainstorm
→ spec → plan cycle; N2/N4 are small tunings.
