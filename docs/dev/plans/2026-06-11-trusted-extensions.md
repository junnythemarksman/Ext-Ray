# Trusted Extensions (Phase 9.6) Implementation Plan

> Implement task-by-task; steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-extension "Trusted" concept (trust-with-re-alert-on-change) that replaces the full-mute ignore list, excludes trusted extensions from the grade transparently, and auto-revokes trust on any material change.

**Architecture:** Pure cores decide (`guardian.evaluateScan` emits `revokeTrust`; `report.buildReport` partitions + excludes trusted from the grade); the SW and UIs are thin glue. Storage key `ignored`→`trusted` via a v1→v2 migration.

**Spec:** [docs/dev/specs/2026-06-11-trusted-extensions-design.md](../specs/2026-06-11-trusted-extensions-design.md)

**Commit trailer:** none — this repo is now public and commits use the plain author identity.
**Branch:** `feat-trusted`.

---

## Task 1: Storage rename + v2 migration (TDD)

**Files:** modify `src/storage/storage.ts`; modify `src/storage/storage.test.ts`.

- [ ] **Step 1 — failing test.** In `src/storage/storage.test.ts`, add (match the file's fake-chrome setup):
```ts
  it('migrate v1→v2 renames ignored→trusted and removes the old key', async () => {
    await chrome.storage.local.set({ schemaVersion: 1, ignored: ['a', 'b'] });
    await migrate();
    const all = await chrome.storage.local.get(null);
    expect(all.trusted).toEqual(['a', 'b']);
    expect('ignored' in all).toBe(false);
    expect(all.schemaVersion).toBe(2);
  });
  it('getTrusted/setTrusted round-trip', async () => {
    await setTrusted(['x']);
    expect(await getTrusted()).toEqual(['x']);
  });
```
Add `getTrusted, setTrusted, migrate` to the test's import from `./storage` if not present. Run `npx vitest run src/storage/storage.test.ts` → FAIL (no `getTrusted`/`setTrusted`; migration absent).

- [ ] **Step 2 — implement.** In `src/storage/storage.ts`:
  - `export const SCHEMA_VERSION = 2;`
  - In `KEYS`, replace `ignored: 'ignored',` with `trusted: 'trusted',`.
  - Replace the `getIgnored`/`setIgnored` exports with:
```ts
export const getTrusted = (): Promise<string[]> => read(KEYS.trusted, [] as string[]);
export const setTrusted = (ids: string[]): Promise<void> => write(KEYS.trusted, ids);
```
  - Replace `migrate()` with:
```ts
/**
 * Bring stored data up to SCHEMA_VERSION. Idempotent — safe on every SW startup.
 * v1→v2 renames the legacy `ignored` list to `trusted` (the closest-meaning carry-over:
 * an extension the user chose to silence becomes one they trust, now with re-alert-on-change).
 */
export async function migrate(): Promise<void> {
  const from = await getSchemaVersion();
  if (from >= SCHEMA_VERSION) return;
  if (from < 2) {
    const legacy = await read<string[] | undefined>('ignored', undefined);
    if (legacy !== undefined) {
      await write(KEYS.trusted, legacy);
      await chrome.storage.local.remove('ignored');
    }
  }
  await write(KEYS.schemaVersion, SCHEMA_VERSION);
}
```
Run the test → PASS.

- [ ] **Step 3 — commit:** `git add src/storage/storage.ts src/storage/storage.test.ts && git commit -m "feat(storage): rename ignored→trusted with v2 migration"`

---

## Task 2: Types

**Files:** modify `src/types.ts`.

- [ ] **Step 1.** In `ScanInput`, rename `ignored: string[];` → `trusted: string[];`.
- [ ] **Step 2.** In `ScanResult`, after `classified` add: `revokeTrust: string[];   // trusted ids whose trust a material change voided` and update the `classified` comment to "all non-suppressed changes + severity".
- [ ] **Step 3.** In `ReportView`, add `trusted: ReportCard[]; // trusted — excluded from the grade` and change `counts` to `{ total: number; risky: number; low: number; trusted: number }`.
- [ ] **Step 4 — verify + commit:** `npm run typecheck` will now fail in guardian/report/callers (expected; fixed in later tasks) — so just commit the type changes: `git add src/types.ts && git commit -m "feat(types): trusted (ScanInput/ScanResult.revokeTrust, ReportView.trusted)"`. (Do NOT run typecheck as a gate here; it goes green after Task 4.)

---

## Task 3: Guardian — trusted semantics + revokeTrust (TDD, pure, security-critical)

**Files:** modify `src/guardian/guardian.ts`, `src/guardian/guardian.test.ts`.

- [ ] **Step 1 — failing tests.** In `src/guardian/guardian.test.ts`: globally rename `ignored:` → `trusted:` in every existing `evaluateScan(...)` input (the field renamed). Then ADD a `describe('trusted', ...)` with (build snapshots in the file's existing style; a trusted id is passed via `trusted: [id]`):
```ts
  // info-level churn for a trusted extension is silenced and does NOT revoke trust
  it('suppresses info changes for a trusted extension without revoking trust', () => {
    const prev = [ext('t', { version: '1.0.0' })];
    const curr = [ext('t', { version: '1.0.1' })]; // version bump, no prior stability stamp → info
    const r = evaluateScan({ prev, curr, timestamps: {}, settings: notifyOn, trusted: ['t'], now: 0 });
    expect(r.classified).toHaveLength(0);
    expect(r.revokeTrust).toEqual([]);
    expect(r.notification).toBeNull();
  });
  // a MATERIAL change (host expansion) for a trusted extension alerts AND revokes trust
  it('alerts and revokes trust on a material change to a trusted extension', () => {
    const prev = [ext('t', { permissions: [], hostPermissions: [] })];
    const curr = [ext('t', { permissions: ['scripting'], hostPermissions: ['<all_urls>'] })];
    const r = evaluateScan({ prev, curr, timestamps: {}, settings: notifyOn, trusted: ['t'], now: 0 });
    expect(r.revokeTrust).toEqual(['t']);
    expect(r.classified.some((c) => c.severity === 'high')).toBe(true);
    expect(r.notification).not.toBeNull();
  });
  // non-trusted extensions are unaffected
  it('does not revoke or suppress for non-trusted extensions', () => {
    const prev = [ext('n', { permissions: [] })];
    const curr = [ext('n', { permissions: ['cookies'] })];
    const r = evaluateScan({ prev, curr, timestamps: {}, settings: notifyOn, trusted: [], now: 0 });
    expect(r.revokeTrust).toEqual([]);
    expect(r.classified).toHaveLength(1);
  });
```
(Use/define the `ext(id, overrides)` snapshot helper and a `notifyOn` Settings consistent with the file's existing tests; if the file already has such helpers, reuse them.) Run → FAIL (`revokeTrust` undefined; `trusted` field).

- [ ] **Step 2 — implement.** In `evaluateScan`, replace the block from `const ignoredSet = …` through the `return` with:
```ts
  const trustedSet = new Set(trusted);
  const ctx: ClassifyCtx = { currById: new Map(curr.map((e) => [e.id, e])), prevTimestamps: timestamps, now };

  const classified: ClassifiedChange[] = [];
  const revokeTrust: string[] = [];
  const revoked = new Set<string>();
  for (const change of changes) {
    const severity = classifySeverity(change, ctx);
    if (trustedSet.has(change.id)) {
      // Trusted: silence benign (info) churn; a material change (notable/high) still alerts AND
      // voids trust so the extension reappears at its true tier next scan.
      if (severity === 'info') continue;
      if (!revoked.has(change.id)) { revoked.add(change.id); revokeTrust.push(change.id); }
    }
    classified.push({ change, severity });
  }

  const noteworthy = classified.filter((c) => c.severity !== 'info');
  const notification = settings.notify ? buildNotification(noteworthy) : null;

  if (tGuardian.enabled) {
    tGuardian('scan evaluated', {
      changes: classified.length, noteworthy: noteworthy.length, notified: notification !== null,
      revoked: revokeTrust.length, suppressed: changes.length - classified.length,
    });
  }
  return { timestamps: newTimestamps, classified, notification, revokeTrust };
```
Also update the destructure on the function's first line: `const { prev, curr, timestamps, settings, trusted, now } = input;` and the FIRST-RUN early return to include the new field: `return { timestamps: newTimestamps, classified: [], notification: null, revokeTrust: [] };`. Run tests → PASS.

- [ ] **Step 3 — commit:** `git add src/guardian/guardian.ts src/guardian/guardian.test.ts && git commit -m "feat(guardian): trusted suppresses info churn, re-alerts + revokes on material change"`

---

## Task 4: Report — partition + grade-exclude (TDD, pure)

**Files:** modify `src/report/report.ts`, `src/report/report.test.ts`.

- [ ] **Step 1 — failing tests.** Append to `src/report/report.test.ts` (reuse its snapshot style):
```ts
  it('excludes trusted extensions from risky/low and from the grade', () => {
    const crit = mk('crit', ['debugger']);          // would be critical
    const lowE = mk('low', ['storage']);
    const view = buildReport([crit, lowE], ['crit']);
    expect(view.trusted.map((c) => c.id)).toEqual(['crit']);
    expect(view.risky.find((c) => c.id === 'crit')).toBeUndefined();
    expect(view.counts).toEqual({ total: 2, risky: 0, low: 1, trusted: 1 });
    // grade computed over the non-trusted (only the low) → not F
    expect(view.grade.grade).not.toBe('F');
  });
  it('all-trusted fleet grades A with the trusted count', () => {
    const view = buildReport([mk('a', ['debugger']), mk('b', ['scripting'])], ['a', 'b']);
    expect(view.grade.grade).toBe('A');
    expect(view.counts.trusted).toBe(2);
    expect(view.risky).toHaveLength(0);
  });
  it('keeps the risky+low+trusted === total invariant', () => {
    const view = buildReport([mk('a', ['debugger']), mk('b', ['cookies']), mk('c', ['storage'])], ['b']);
    expect(view.risky.length + view.low.length + view.trusted.length).toBe(3);
  });
```
(Define `mk(id, perms)` or reuse the file's existing snapshot builder; trusted is the 2nd arg.) Run → FAIL.

- [ ] **Step 2 — implement** `buildReport`:
```ts
export function buildReport(snapshots: ExtSnapshot[], trusted: string[] = []): ReportView {
  const trustedSet = new Set(trusted);
  const scored = snapshots.map((snapshot) => ({ snapshot, verdict: scoreExtension(snapshot) }));

  // Grade reflects only NON-trusted extensions (trusted are acknowledged + excluded).
  const grade = gradeFleet(scored.filter((x) => !trustedSet.has(x.snapshot.id)).map((x) => x.verdict));

  scored.sort((a, b) => b.verdict.score - a.verdict.score || byName(a.snapshot.name, b.snapshot.name));

  const risky: ReportCard[] = [];
  const low: ReportRow[] = [];
  const trustedCards: ReportCard[] = [];
  const card = (snapshot: ExtSnapshot, verdict: ReturnType<typeof scoreExtension>): ReportCard => ({
    id: snapshot.id, name: snapshot.name, version: snapshot.version, tier: verdict.tier,
    score: verdict.score, reasons: verdict.reasons,
    enabled: snapshot.enabled, canDisable: snapshot.mayDisable, iconUrl: snapshot.iconUrl,
  });
  for (const { snapshot, verdict } of scored) {
    if (trustedSet.has(snapshot.id)) { trustedCards.push(card(snapshot, verdict)); continue; }
    if (verdict.tier === 'low') {
      low.push({
        id: snapshot.id, name: snapshot.name, tier: verdict.tier,
        enabled: snapshot.enabled, canDisable: snapshot.mayDisable, iconUrl: snapshot.iconUrl,
      });
    } else {
      risky.push(card(snapshot, verdict));
    }
  }

  return {
    grade, risky, low, trusted: trustedCards,
    counts: { total: snapshots.length, risky: risky.length, low: low.length, trusted: trustedCards.length },
  };
}
```
(Add `Tier`/`ReturnType` imports only if needed; `ReportCard`/`ReportRow`/`ReportView` already imported.) Update the file's top invariant comment to `risky + low + trusted === total`. Run tests → PASS. Then `npm run typecheck` → should now be GREEN across guardian+report+types.

- [ ] **Step 3 — commit:** `git add src/report/report.ts src/report/report.test.ts && git commit -m "feat(report): partition trusted out of risky/low and exclude from the grade"`

---

## Task 5: Service worker wiring + trust revocation

**Files:** modify `src/background/index.ts`.

- [ ] **Step 1.** Change the storage import: `getIgnored` → `getTrusted, setTrusted`.
- [ ] **Step 2.** In `runScan`, change the `Promise.all` destructure `ignored` → `trusted` (and the `getIgnored()` call → `getTrusted()`), pass `trusted` into `evaluateScan({ …, trusted, now })`.
- [ ] **Step 3.** Replace the persist line with trust-revocation handling:
```ts
    const writes: Array<Promise<void>> = [setSnapshot(curr), setTimestamps(result.timestamps)];
    if (result.revokeTrust.length) {
      const revoke = new Set(result.revokeTrust);
      writes.push(setTrusted(trusted.filter((id) => !revoke.has(id))));
      if (tSec.enabled) tSec('trust revoked (material change)', { ids: result.revokeTrust.length });
    }
    await Promise.all(writes);
```
- [ ] **Step 4 — verify + commit:** `npm run typecheck && npm test` (93+ unit, all green). `git add src/background/index.ts && git commit -m "feat(guardian): SW passes trusted set + auto-revokes trust on material change"`

---

## Task 6: Popup — Trust/Untrust + Trusted section (render + controller) + e2e

**Files:** modify `popup/render.ts`, `popup/index.ts`, `popup/popup.css`, `e2e/popup.spec.ts`.

- [ ] **Step 1 — render.ts.** Add an optional trust action. Change `renderActions` signature to `renderActions(enabled, canDisable, trustAction?: 'trust' | 'untrust')` and, when `trustAction` is set, append a button before returning:
```ts
  if (trustAction) {
    const t = el('button', 'btn btn-trust', trustAction === 'trust' ? 'Trust' : 'Untrust');
    t.dataset.action = trustAction;
    wrap.append(t);
  }
```
In `renderCard`, pass `'trust'`: `c.append(renderActions(card.enabled, card.canDisable, 'trust'));`. Leave `renderRow` (low rows) without a trust action.
Header summary: replace the `el('div','summary', …)` ternary's non-empty branch with
`` `${view.counts.risky} need a look · ${view.counts.low} low-risk${view.counts.trusted ? ` · ${view.counts.trusted} trusted (excluded)` : ''}` ``.
After the low-section block, add a trusted section:
```ts
  if (view.trusted.length) {
    const section = el('section', 'trusted-section');
    section.append(el('h2', 'trusted-title', 'trusted'));
    for (const t of view.trusted) {
      const r = el('div', `row tier-${t.tier} is-trusted`);
      r.dataset.ext = t.id;
      r.dataset.enabled = String(t.enabled);
      r.append(iconImg(t.iconUrl, 24), el('span', 'dot'), el('span', 'name', t.name),
        el('span', 'tier-label', TIER_LABEL[t.tier]));
      r.append(renderActions(t.enabled, t.canDisable, 'untrust'));
      section.append(r);
    }
    root.append(section);
  }
```

- [ ] **Step 2 — controller (popup/index.ts).** Add to the storage import: `import { getTrusted, setTrusted } from '../src/storage/storage';`. In `load()`, fetch trusted and pass it:
```ts
  const [snapshots, trusted] = await Promise.all([getExtensions().catch(() => null), getTrusted()]);
  if (snapshots === null) { renderError(root, 'Couldn’t read your extensions.'); return; }
  const view = buildReport(snapshots, trusted);
```
In `onClick`, add before the disable branch:
```ts
  if (btn.dataset.action === 'trust' || btn.dataset.action === 'untrust') {
    const trusted = await getTrusted();
    const next = btn.dataset.action === 'trust'
      ? [...new Set([...trusted, id])]
      : trusted.filter((t) => t !== id);
    await setTrusted(next);
    await load(); // full re-render reflects the new partition + grade
    return;
  }
```

- [ ] **Step 3 — popup.css.** Append (tokens already imported):
```css
.trusted-section { margin-top: 10px; }
.trusted-title { font-size: 10px; text-transform: uppercase; letter-spacing: .06em;
  color: var(--er-muted); margin: 8px 0 4px; }
.row.is-trusted { opacity: .8; }
.row .tier-label { margin-left: auto; }
.btn-trust { background: transparent; }
@media (forced-colors: active) { .btn-trust { border: 1px solid ButtonText; } }
```

- [ ] **Step 4 — e2e (e2e/popup.spec.ts), ADD one test (change nothing existing):**
```ts
test('Trust moves a card into the Trusted section and excludes it from the grade', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(popupUrl(extensionId));
  const critical = page.locator('article.card.tier-critical');
  const id = await critical.getAttribute('data-ext');
  await critical.locator('button[data-action="trust"]').click();
  // it leaves the risky cards and appears in the trusted section
  await expect(page.locator(`article.card[data-ext="${id}"]`)).toHaveCount(0);
  await expect(page.locator(`.trusted-section [data-ext="${id}"]`)).toHaveCount(1);
  await expect(page.locator('.summary')).toContainText('trusted (excluded)');
  await expect
    .poll(() => swEval<string[]>(context, async () => (await chrome.storage.local.get('trusted')).trusted ?? []))
    .toContain(id);
  await page.close();
});
```

- [ ] **Step 5 — verify + commit:** `npm run typecheck && npm run build && npx playwright test e2e/popup.spec.ts e2e/smoke.spec.ts` (existing popup tests UNCHANGED-green + the new one; if an existing one fails the selector contract broke — STOP). `git add popup/render.ts popup/index.ts popup/popup.css e2e/popup.spec.ts && git commit -m "feat(popup): Trust/Untrust buttons + collapsed Trusted section"`

---

## Task 7: Options rename + e2e update

**Files:** modify `options/render.ts`, `options/index.ts`, `e2e/options.spec.ts`.

- [ ] **Step 1 — options/render.ts.** Rename the `ignored` param → `trusted`; `ignoreRow(ext, ignored)` → `trustRow(ext, trusted)` with `box.dataset.trust = ext.id` (was `dataset.ignore`); section title `'Ignore alerts from'` → `'Trusted (alerts only if they change)'`; the `ignoredSet`/loop use `trusted`.
- [ ] **Step 2 — options/index.ts.** Storage import `getIgnored/setIgnored` → `getTrusted/setTrusted`; the closure var `ignored` → `trusted`; the handler branch `const ignoreId = target.dataset.ignore;` → `const trustId = target.dataset.trust;` and its body uses `trusted`/`setTrusted`; the `renderOptions(settings, extensions, ignored, root)` call → `trusted`.
- [ ] **Step 3 — e2e/options.spec.ts.** In the "notify toggle and ignore toggle persist" test: `input[data-ignore]` → `input[data-trust]`, `.getAttribute('data-ignore')` → `'data-trust'`, and the storage assertion `chrome.storage.local.get('ignored')…ignored` → `get('trusted')…trusted`. Rename the test title's "ignore" → "trust".
- [ ] **Step 4 — verify + commit:** `npm run typecheck && npm run build && npx playwright test e2e/options.spec.ts` (4 passed). `git add options/render.ts options/index.ts e2e/options.spec.ts && git commit -m "feat(options): rename the ignore list to the Trusted list"`

---

## Task 8: Docs + full verification

**Files:** modify `README.md`, `docs/ROADMAP.md`.

- [ ] **Step 1 — full suite:** `npm run typecheck && npm test && npm run test:e2e && npm run verify:build` — tsc clean; unit green; e2e green (existing + 1 popup + options updated); check-dist OK.
- [ ] **Step 2 — README:** in the "How it works" paragraph add a sentence on trusting; in the popup data-flow mermaid sequence add a `Trust/Untrust → setTrusted` interaction and note trusted excluded from grade; in the architecture flowchart the popup already → report; add a note that report takes the trusted set. In the guardian "meaningful change" flowchart, add that a trusted extension's material change **re-alerts and revokes trust**.
- [ ] **Step 3 — ROADMAP:** add a Phase 9.6 row (✅): "Trusted extensions — trust-with-re-alert-on-change replaces the full-mute ignore list; trusted excluded from grade (shown transparently), auto-revoked on material change. Remediates the threat-model concern that ignoring fully muted an extension."
- [ ] **Step 4 — commit:** `git add README.md docs/ROADMAP.md && git commit -m "docs: record Trusted extensions (Phase 9.6) + diagram updates"`
- [ ] **Step 5:** finish branch — final review, fast-forward merge `feat-trusted` → main, push; then refresh the desktop ZIP + unpacked folder.

---

## Self-Review
**Coverage:** §3.1→T1, §3.4→T2, §3.2→T3, §3.3→T4, §3.5→T5, §3.6→T6, §3.7→T7, §4 tests across T1/T3/T4/T6/T7, docs→T8. ✓
**Placeholders:** none — verbatim code for the pure cores + exact edit specs for glue against the read current files. ✓
**Consistency:** storage `trusted` key + `getTrusted/setTrusted` used identically in T1/T5/T6/T7; `ScanInput.trusted` + `ScanResult.revokeTrust` defined T2, produced T3, consumed T5; `buildReport(snapshots, trusted)` defined T4, called T6; `ReportView.trusted` + `counts.trusted` defined T2, produced T4, consumed T6 render; e2e selectors preserved except the intended `data-ignore`→`data-trust` rename (updated in its own test T7). Unit count rises (storage +2, guardian +3, report +3). ✓
