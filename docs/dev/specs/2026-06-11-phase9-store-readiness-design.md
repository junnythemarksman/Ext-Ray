# Ext-Ray Phase 9 — Store-Listing Readiness Design

- **Date:** 2026-06-11
- **Status:** Approved design, pre-implementation
- **Elaborates:** main [design spec](2026-06-05-ext-ray-design.md) §10 (naming & distribution); [roadmap](../../ROADMAP.md) Phase 9 (privacy policy + Limited Use disclosure, first-run screen pre-empting the `management` warning, USPTO trademark check)

## 1. Summary

Phase 9 makes Ext-Ray **submission-ready** for the Chrome Web Store: everything the repo can
deliver is built (one code surface + four documents + a screenshot generator), and every step only
the owner can perform (hosting, dashboard fields, identity, fees) becomes a precise checklist.
Nothing is submitted, hosted, or filed on the owner's behalf.

Grounded in a primary-sourced 2025–26 CWS policy research pass (7-agent workflow, 2026-06-08) and
a delta pass (2026-06-11). The facts that shape this phase: `management` guarantees **manual
review**; the dashboard **Privacy Practices tab is a hard publishing gate** even for a zero-data
extension; privacy policy is now set **per-item**; there is **one appeal per violation** (2025
rule); screenshots are compared against actual behavior; **no superlatives** in metadata; an
active review backlog means budgeting 1–2+ weeks. Sources: [program policies](https://developer.chrome.com/docs/webstore/program-policies/policies),
[user-data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq),
[dashboard privacy](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy),
[2025 policy updates](https://developer.chrome.com/blog/cws-policy-updates-2025),
[extensions I/O 2026](https://developer.chrome.com/blog/extensions-io-2026) (all 2025–26).

## 2. Decisions (from brainstorming, 2026-06-08 → 2026-06-11)

1. **Scope = submission-ready artifacts (Q1).** Repo delivers code + docs + screenshots; external
   actions are a documented owner checklist.
2. **First-run = dedicated onboarding page opened once on install (Q2).** Strongest pre-emption of
   the "Manage your apps, extensions, and themes" install warning — the reassurance appears at the
   moment of maximum anxiety. Supersedes the Phase 8 spec §9 note that Ext-Ray "opens no tab."
3. **Privacy policy lives in the dedicated public repo `ext-ray-privacy` (Q3, owner-directed),**
   already authored and pushed (finalized 2026-06-11 with contact `extray.support@gmail.com`).
   Served via GitHub Pages at `https://junnythemarksman.github.io/ext-ray-privacy/` once the owner
   enables Pages. The main repo does NOT duplicate the policy; the listing doc references the URL.
4. **Store screenshots are generated from the real product (Q4).** A `npm run shots` script drives
   the existing Playwright harness (dist + a varied fixture fleet) and captures the popup, options,
   and onboarding pages at the CWS 1280×800 spec — screenshots match behavior by construction,
   neutralizing the "screenshots must match actual behavior" rejection class.
5. **Trademark: ship under "Ext-Ray," file later if scaling (research verdict).** No live USPTO
   mark found; the 2017 academic "Ex-Ray" is a paper, not a product/mark; Amazon X-Ray and
   Anyscale Ray are different goods/classes. Clear-but-provisional, not legal advice — recorded in
   a summary doc with a recommended next step (optional Class 9 filing + attorney before scaling).

## 3. Architecture

One small code surface (onboarding) + glue, plus documents. The codebase's standard split applies:
static page, thin script, SW wiring; no new pure core is needed.

### 3.1 `onboarding/` — first-run page (new)

- **`onboarding/index.html`** — static content, structure mirroring `popup/index.html`
  (`<div id="app">` not needed — content is static; author it directly in HTML for simplicity):
  - Header: Ext-Ray name + icon.
  - Three reassurance points (the §10 pre-emption): **read-only** (never changes anything without
    your click) · **100 % on-device** (no servers, no accounts, nothing leaves the browser) ·
    **why `management`** (it's the permission that lets Ext-Ray read your extension list and
    Chrome's own warning text — the install warning you just saw is about *reading*, and Ext-Ray
    transmits nothing).
  - What happens next: click the toolbar icon for your first audit; the guardian re-scans in the
    background and notifies on suspicious changes.
  - Link to the privacy policy URL (§2.3).
  - A **"Got it"** button.
- **`onboarding/index.ts`** — one listener: the button calls `window.close()` (works because the
  SW opened the tab; no chrome.* API or permission needed). MV3 extension-page CSP forbids inline
  scripts, hence the tiny module instead of an `onclick`.
- **`onboarding/onboarding.css`** — reuses the popup's dark-theme variables; 720 px column.

### 3.2 `src/background/index.ts` (modify) — open once on install

In the existing `chrome.runtime.onInstalled` listener, add the reason guard:
```ts
chrome.runtime.onInstalled.addListener((details) => {
  void init();
  if (details.reason === 'install') {
    void chrome.tabs.create({ url: chrome.runtime.getURL('onboarding/index.html') });
  }
});
```
`reason === 'install'` fires exactly once per installation (not on updates/reloads), so no storage
flag is needed. `tabs.create` requires **no permission** — the F1 check-dist guard (exactly 4
permissions) continues to pass.

### 3.3 Build & checks (modify)

- `vite.config.ts`: add `onboarding/index.html` to the pages-pass `input`.
- `tsconfig.json` `include`: add `"onboarding"`.
- `scripts/check-dist.mjs`: assert `dist/onboarding/index.html` exists (extend the referenced-files
  list manually — onboarding is not referenced by the manifest).

### 3.4 `scripts/shots.mjs` + `npm run shots` (new) — store screenshots

Standalone Node script (mirrors the proven demo-runner pattern; uses `@playwright/test`'s
`chromium`): creates a temp fixture fleet spanning tiers (critical/high/medium/low — the three
Phase 8 fixtures already cover critical/`tabs`-high/low; add one `clipboardWrite` medium fixture
inline in a temp dir), launches the persistent context
with `dist/`, captures **1280×800** PNGs of (a) the popup report (graded fleet), (b) the options
page, (c) the onboarding page, into `shots/` (gitignored). Run on demand before submission:
`"shots": "npm run build && node scripts/shots.mjs"`.

### 3.5 Documents (new, under `docs/store/`)

- **`docs/store/listing.md`** — the submission text, copy-paste ready:
  - Short + full description (accurate, zero superlatives, leads with on-device/read-only).
  - **Single-purpose statement** (dashboard field): *"Audits the security and privacy risk of the
    user's installed Chrome extensions entirely on-device, read-only, with no data collection or
    network transmission."*
  - **Per-permission justifications** (dashboard fields): management (read-only `getAll` +
    `getPermissionWarningsById` for on-device scoring; `setEnabled`/`uninstall` only on explicit
    user click), storage (local settings + last snapshot only), alarms (periodic re-scan),
    notifications (alert on suspicious change).
  - Remote code: **No**. Data types collected: **none**. Limited-Use certification: trivially
    satisfied (nothing collected). Category recommendation: **Tools** (owner decides).
  - Screenshot plan: the three `npm run shots` outputs + capture instructions.
- **`docs/store/trademark.md`** — the §2.5 verdict, the searches performed, the Ex-Ray/X-Ray/Ray
  distinctions, and the recommended next step. Explicit "not legal advice."
- **`docs/store/submission-checklist.md`** — owner-only steps, ordered, each with its source:
  one-time developer fee + **2SV**; **Trader/Non-Trader** declaration; **create the
  `extray.support@gmail.com` alias** (it does not exist yet); enable **GitHub Pages** on
  `ext-ray-privacy` (Settings → Pages → main/root) and verify the URL renders; paste the per-item
  **privacy policy URL**; fill the **Privacy Practices tab** (single purpose, justifications, no
  data types, Limited Use, remote code = No); build + **test the exact ZIP** (`npm run verify:build`,
  load `dist/` packed); upload; expect **manual review** (management) + the 2026 **backlog**
  (1–2+ weeks); **one appeal** — self-audit before submitting, never appeal before fixing;
  verified-CRX opt-in is **irreversible key binding** (optional, decide deliberately); security
  tools are excluded from "Featured" (expectation-setting).

### 3.6 `docs/ROADMAP.md` + `README.md` (modify, end of phase)

Phase 9 row → ✅ with what shipped; Phase 10 → `◀ next`. README gains an install/onboarding note
and the privacy-policy link.

## 4. Types

None. No `src/types.ts` changes — onboarding is static UI; the SW change is wiring.

## 5. Testing

- **`e2e/onboarding.spec.ts`** (new): launching the persistent context IS a fresh install →
  `onInstalled(reason='install')` fires → assert a page with the onboarding URL appears
  (`context.waitForEvent('page')` / poll `context.pages()`), renders the three reassurance points
  and the privacy-policy link, and trips no `console.error`/`pageerror` (the auto error-gate
  already attaches). Assert "Got it" closes the tab.
- **Existing suites must stay green**: the new auto-opened tab must not break the 13 existing e2e
  tests (they use `context.newPage()` and never assert page counts; the error collector now also
  watches the onboarding tab — which must therefore be error-free, a feature not a hazard).
- `npm run verify:build` extended check (§3.3) gates the loadable contract.
- The shots script is verified by running it once (artifacts inspected, not asserted).

## 6. Error handling (boundaries only)

`tabs.create` failure on install is non-critical glue — `.catch`-guard it with a `sec.guardian`
trace (mirroring the Task 7 notification guard) so a failed onboarding open can never break
`init()`. `window.close()` cannot fail in the opened-by-extension tab.

## 7. Honest limitations / non-goals (YAGNI)

- **No external actions:** no CWS upload, no Pages enablement, no trademark filing, no email-alias
  creation — owner checklist items.
- No localization (English only), no analytics/telemetry on any page (constraint), no first-run
  popup banner or options "About" section (the onboarding page is the single reassurance surface),
  no EU-DSA trader paperwork authoring (owner decision recorded in the checklist).
- The onboarding page is intentionally static — no settings, no permission re-explanations beyond
  the three points; the options page remains the configuration surface.
- Screenshots are generated against a **fixture** fleet labeled as such in `listing.md` — the
  fixtures' `installType: development` (+0.15) tier inflation is documented there so the owner
  reviews the captures against the "screenshots must match" rule before uploading.
