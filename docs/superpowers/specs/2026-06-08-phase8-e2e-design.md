# Ext-Ray Phase 8 — Integration & In-Browser E2E Design

- **Date:** 2026-06-08
- **Status:** Approved design, pre-implementation
- **Author:** Genaro Peque, Jr
- **Elaborates:** main [design spec](2026-06-05-ext-ray-design.md) §9 (testing); [roadmap](../../ROADMAP.md) Phase 8 (load unpacked in a real browser, exercise every control, watch `console.error`/`pageerror`, screenshot on failure; clear deferred robustness cases a–e)

## 1. Summary

Phase 8 is the first time the whole extension runs in a real Chromium. We add `@playwright/test`
(the first new dependency since scaffold) in an `e2e/` tree, load the built `dist/` **plus three small
real fixture extensions** via `launchPersistentContext`, and drive the popup, options page, and
background guardian end-to-end — failing on any uncaught `console.error`/`pageerror`, with
screenshots + traces on failure. The existing 80 Vitest unit tests and `npm run typecheck` are
untouched; Playwright is a separate runner.

Phase 8 also discharges the five deferred robustness/UX cases (a–e) accumulated across Phases 4–7,
**using the right tool per case** (the "pragmatic split"): observable cases in E2E, one small feature
built and wired, race/failure windows hardened or documented in code rather than covered by flaky
tests that only look like coverage.

## 2. Decisions (from brainstorming, 2026-06-08)

1. **Test data = real fixture extensions + storage seeding (Q1).** The popup audit reads the fleet
   **live** via `chrome.management`; the guardian diff compares a *prior* snapshot (from `storage`)
   against the live set. A fresh persistent context has no other extensions, so we supply both:
   three real unpacked fixture extensions (deterministic permission tiers) for the live audit path,
   and a seeded `chrome.storage.local` prior snapshot for the diff path. **No mocking of
   `chrome.management`** — we test the real edges.
2. **Robustness = pragmatic split (Q2).** E2E covers the observable cases: happy paths, (c)
   notification icon-safety (happy path E2E + code guard for the failure), (e) the options-page width.
   (d) `notifications.onClicked → openPopup` is **built** and wired. (a) terminal unhandled-rejection,
   (b) notify/persist window, and the (e) managed-state *render* are hardened/documented/unit-covered
   in code (see §6, §5.2) — **not** chased with timing-dependent or un-triggerable E2E.
3. **Browser = Playwright-managed Chromium, new headless (Q3).** `channel: 'chromium'` (new headless
   supports extensions), no `DISPLAY` dependency, version-pinned/reproducible; `HEADED=1` env toggle
   flips to headed for debugging (`DISPLAY=:0` is available).
4. **Case (b) is a documented trade-off, not a reorder (Q4).** Reading the code showed that
   reordering `runScan` to persist-before-notify would convert a benign duplicate into a *silently
   missed* security alert. We keep notify-before-persist (**at-least-once** delivery) and document it.
   For a security tool, a rare duplicate beats a missed alert.

## 3. Architecture

A scripted Playwright harness around the unmodified build, plus three small SW code changes. The
harness lives entirely under `e2e/`; product code under `src/` changes only for (a)/(b)/(d).

### 3.1 `playwright.config.ts` (new, project root)

- `testDir: 'e2e'`; one project named `chromium`.
- `workers: 1`, `fullyParallel: false` — the persistent context + extension state is stateful; serial
  runs are deterministic.
- `use: { screenshot: 'only-on-failure', trace: 'retain-on-failure' }`.
- No `globalSetup` for the build; the npm script chains it (§3.6) so `dist/` is fresh and explicit.
- Channel/headless are set per-test in the fixture (§3.2), not globally, because extension loading
  needs `launchPersistentContext` (not the default `browser`/`page` fixtures).

### 3.2 `e2e/fixtures.ts` (new) — custom test fixtures

Extends `@playwright/test`'s `base` with three fixtures, following the official Playwright
Chrome-extension pattern (test-scoped for isolation; the context is cheap enough at this test count):

- `context` — `chromium.launchPersistentContext('', { channel: 'chromium', headless: !process.env.HEADED, args: [`--disable-extensions-except=${paths}`, `--load-extension=${paths}`] })`, where
  `paths` is the comma-joined absolute paths of `dist/` + the three fixture extensions. Closed in teardown.
- `extensionId` — derived from the Ext-Ray service worker:
  ```ts
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  const extensionId = sw.url().split('/')[2];
  ```
  (The fixture extensions have no background service worker, so the only SW is Ext-Ray's.)
- An **error collector** auto-attached to every page the test opens: `page.on('console', …)` for
  `type === 'error'` and `page.on('pageerror', …)` push into an array asserted empty at test end —
  the cross-cutting "any uncaught error = High severity" gate from the global testing rule.

A small `swEval(context, fn, arg)` helper wraps `serviceWorker.evaluate` for asserting/!seeding SW-side
state (`chrome.management.get`, `chrome.storage.local`, `chrome.alarms.get`, `chrome.notifications.getAll`).

### 3.3 `e2e/fixtures/extensions/` (new) — three real unpacked MV3 fixtures

Declared metadata only (all Ext-Ray reads), each a single `manifest.json` (MV3, stable name/version):

| dir | manifest declares | scored tier |
|---|---|---|
| `critical-ext/` | `permissions:["scripting"]`, `host_permissions:["<all_urls>"]` | critical |
| `high-ext/` | `permissions:["cookies"]` | high |
| `low-ext/` | `permissions:["storage"]` | low |

No background/content scripts — Ext-Ray only consumes declared `permissions`/`host_permissions` and
`getPermissionWarningsById`, which Chrome computes from the manifest. Ext-Ray filters itself out, so
these three are the audited fleet with deterministic tiers.

### 3.4 `e2e/*.spec.ts` (new) — see §5.

### 3.5 `src/background/index.ts` (modify) — (a)/(b)/(d), see §6.

### 3.6 `package.json` / `.gitignore` / tooling (modify)

- devDep: `@playwright/test` (version pinned; consistent single version per the global dependency rule).
- Scripts: `"test:e2e": "npm run build && playwright test"`, `"test:e2e:headed": "HEADED=1 npm run test:e2e"`.
- `.gitignore`: `playwright-report/`, `test-results/`.
- `e2e/` is **not** added to the root `tsconfig.json` `include` (which stays `["src","popup","options"]`),
  so `npm run typecheck` is unaffected; Playwright type-checks/transpiles its own specs at run time.
- Post-install note (plan, not a script): `npx playwright install chromium` downloads the browser
  once to `~/.cache/ms-playwright` (ext4).

## 4. Types

No additions to `src/types.ts`. (d) is glue in the SW; the E2E harness types come from `@playwright/test`.

## 5. Tests (E2E specs)

Each spec uses the §3.2 fixtures; the error collector asserts zero `console.error`/`pageerror` for
every page. Screenshots/traces on failure come from config.

### 5.1 `e2e/popup.spec.ts`
- Navigate `chrome-extension://<extensionId>/popup/index.html`.
- Grade header reflects the worst fixture (critical present → low fleet grade).
- One risky **card** per critical/high fixture: correct tier label, reasons, version string, and a
  C1 browser permission-warning line (`getPermissionWarningsById` returns real text for these manifests).
- The low fixture renders as a compact **row**, not a card.
- Honest-limits footer present.
- **Disable** on a fixture card → click → assert the fixture is now disabled
  (`swEval(... chrome.management.get(id) → enabled === false)`). (Disabling is silent — no native dialog.)
- **Remove** button present + enabled. Its `chrome.management.uninstall({showConfirmDialog:true})` opens
  a **native browser dialog Playwright cannot drive** (see §7) → verify the wiring via a narrow SW-side
  spy on `chrome.management.uninstall` (assert it is invoked with the right id), **not** an actual removal.

### 5.2 `e2e/options.spec.ts`
- Navigate the options page.
- Toggle monitoring / cadence `<select>` / notify → assert each persisted
  (`swEval(... getSettings())` reflects the change).
- Toggle an "Ignore alerts" checkbox for a fixture → assert `ignored` updated in storage.
- **Live alarm reconcile:** change cadence → assert `swEval(... chrome.alarms.get('extray-scan'))`
  reports the new `periodInMinutes`; toggle monitoring off → assert the alarm is cleared.
- **(e) options width:** assert the options layout reads at its 420px width — no horizontal overflow
  (`scrollWidth <= clientWidth`), all controls visible — via a bounding-box check (+ failure screenshot).
- **(e) managed-state is NOT E2E'd here** — `mayDisable:false` only occurs for admin/force-installed
  extensions, which normal unpacked fixtures cannot be without enterprise policy (flaky in Playwright).
  The `mayDisable → canDisable` data mapping is already covered by `src/report/report.test.ts`; the
  managed-note render branch is a documented limitation (§7), not faked with a policy hack.

### 5.3 `e2e/guardian.spec.ts`
- Seed (`swEval(... chrome.storage.local.set)`) a **prior snapshot** that differs from the live
  fixtures — e.g. `critical-ext` previously declared only `["storage"]`, now `<all_urls>`+`scripting`
  → `permissions-added` with host-scope expansion = high severity — plus `settings` (monitoring on,
  notify on) and `timestamps`.
- Trigger a scan through an **existing** SW code path (the SW has no `runtime.onMessage` handler, and
  `chrome.alarms.onAlarm` cannot be fired on demand): `swEval(... chrome.management.setEnabled(<a
  fixture id>, false))` fires the SW's `chrome.management.onDisabled` listener → `scheduleScan()`.
  This both triggers the scan and incidentally exercises the C2 push-event wiring. (Disabling is
  silent — no native dialog.)
- Await the asynchronous scan with `expect.poll(() => swEval(... chrome.notifications.getAll()))`,
  then assert one notification exists with the expected batched title/message, and that the stored
  snapshot was updated to the live set.
- **(c)** With the real `icons/icon-128.png` present (it is, in `dist/`), `notifications.create`
  resolves and the SW does not crash; the error collector stays empty. (We assert the happy path is
  icon-safe; the absent-icon rejection is covered by the SW guard in §6, not by deleting a built asset.)

### 5.4 Error gate
Implemented in `fixtures.ts` (§3.2), not a separate spec — every page in every test is watched.

## 6. Product code changes — `src/background/index.ts`

### 6.1 (a) Final-scan rejection cannot become a terminal unhandled rejection
Wrap the body of `runScan` in `try { … } catch (e) { trace('sec.guardian')('scan failed', { … }) }`
so `runScan` never rejects. The chain's tail then has nothing to leak. The existing
`inFlight.catch(() => undefined)` in `scheduleScan` becomes belt-and-suspenders — **kept** (defensive,
harmless). Add a top-level `self.addEventListener('unhandledrejection', (e) => trace(...)(...))` as a
last-resort log — this also catches a rejecting `void init()` (migrate/reconcile) and `void
scheduleScan()`, which the per-call `void` does not. No behavior change beyond swallowing + tracing
errors that previously propagated. *Plan note:* the SW global is `ServiceWorkerGlobalScope`; the plan
must ensure `self.addEventListener('unhandledrejection', …)` type-checks under the current tsconfig
`lib` (add `"webworker"` to `lib`, or a narrow typed cast) so `npm run typecheck` stays clean.

### 6.2 (b) Notify/persist ordering — documented, not reordered
Keep notify-before-persist. Add a comment at the `runScan` notify/persist sequence documenting the
**at-least-once** guarantee: a SW kill in the sub-second window between `notifications.create` and the
snapshot write may re-show **one** notification on the next scan, but no alert is ever lost.
Reordering would instead drop the alert silently — the wrong failure mode for a security tool. Zero
behavior change.

### 6.3 (c) Missing-icon notification is non-fatal
Guard the `chrome.notifications.create(...)` call so a rejected promise (e.g. the icon asset absent)
is caught and traced, never crashing the SW or becoming an unhandled rejection. (The icon ships in
`dist/`, so this is defensive; §5.3 asserts the happy path.)

### 6.4 (d) Build `notifications.onClicked → openPopup`
Add a top-level `chrome.notifications.onClicked.addListener(() => { chrome.action.openPopup().catch(() => chrome.tabs.create({ url: chrome.runtime.getURL('popup/index.html') })); })`.
`chrome.action.openPopup()` is available in MV3 since Chrome 127 but can reject without an active
window/gesture → the `.catch` falls back to opening the popup page in a tab. Wired directly (tiny
glue); verified by inspection + the SW not crashing (a literal notification click is not automatable,
see §7).

## 7. Honest limitations (stated, not hidden)

- **Native uninstall confirm dialog** (`management.uninstall({showConfirmDialog:true})`) is
  browser-chrome UI Playwright cannot interact with → **Remove** is verified by wiring (a narrow
  SW-side spy), not an actual uninstall. This is the one sanctioned exception to "no mocking,"
  forced by an un-automatable native surface.
- **Real notification click** is not automatable → (d) is verified by handler inspection + SW
  stability, not a literal OS/browser notification click.
- **(a)/(b)** are race/failure windows E2E cannot reproduce deterministically → hardened/documented
  in code and verified by inspection/structure. No timing-dependent tests masquerading as coverage.
- **(e) managed-state render** (`mayDisable:false` → managed note, no action buttons) can't be
  triggered with normal unpacked fixtures (it needs admin/force-install policy) → the data mapping is
  unit-tested (`report.test.ts`), the render branch is verified by inspection. No enterprise-policy
  hack in the test harness.
- **new-headless extension support** is the supported path; if it regresses in a Chromium build,
  `HEADED=1` is the fallback (`DISPLAY=:0` present).

## 8. Scope / non-goals (YAGNI)

- Chromium only (it is a Chromium extension) — no Edge/Firefox runs.
- No pixel/visual-regression testing (screenshots are failure artifacts, not assertions).
- No CI YAML — npm scripts only (CI wiring is a later, separate concern).
- No new product features beyond (d).
- No exactly-once notification state machine for (b) — the at-least-once trade-off is intentional.
- Research candidates N1/N3/N4 (peer-group, Nano categorization, runtime-host framing) stay out.
