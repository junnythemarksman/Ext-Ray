# Ext-Ray Phase 6 — Popup Report UI Design

- **Date:** 2026-06-07
- **Status:** Approved design, pre-implementation
- **Elaborates:** main [design spec](2026-06-05-ext-ray-design.md) §5.5; [roadmap](../../ROADMAP.md) Phase 6 (C1 warnings, notification-click wiring deferred, tsconfig include)

## 1. Summary

The popup is Ext-Ray's on-demand audit — the first real user-facing surface. On open it scores
every installed extension, shows an overall A–F fleet grade, lists the risky ones as full cards
(plain-English reasons + the browser's own permission warnings + Disable/Remove) and the benign
many as compact rows, and states its honest limits. All built on the existing pure engines with
**no UI framework** (vanilla TS + CSS, per the minimal-dependency stance).

## 2. Decisions (from brainstorming, 2026-06-07)

1. **Scope (Q1):** the full popup — audit + A–F grade + risk cards + per-card C1 browser warnings
   (`getPermissionWarningsById`) + Disable/Remove + honest-limits + empty/managed/error states.
   **Defer** only the `chrome.notifications.onClicked` → open-popup wiring (a background-SW change
   with `openPopup()` reliability caveats) to a small follow-up.
2. **Layout (Q2):** full cards for risky extensions (tier ≥ medium), compact one-line rows for
   low-risk — everything visible (transparency), benign many de-emphasized (fights alarm fatigue).
3. **No UI framework.** Vanilla TS + a single CSS file. Logic lives in a pure builder; rendering is
   a dumb data→DOM map.

These are grounded in 2024–26 risk-communication research: A–F security grades are well-precedented
(SSL Labs, Mozilla Observatory) and SSL Labs' worst-case rule mirrors our worst-case-weighted grade;
alarm fatigue is the central UX hazard (reserve red for critical, calm for the rest); use plain,
concrete, capability-framed, uncertainty-honest language; satisfy the "2-second test" (grade up top);
color + label + icon, never color alone.

## 3. Architecture

Pure core (tested) + dumb render (Phase 8) + thin `chrome.*` edge — the codebase's standard split.

### 3.1 `report/` — report builder (pure, no I/O)

- **Purpose:** turn the installed-extension snapshots into a fully-prepared view model.
- **Interface:** `buildReport(snapshots: ExtSnapshot[]): ReportView`.
- **Logic:** `scoreExtension` per snapshot → `gradeFleet` over the verdicts → sort **worst-first**
  (by `verdict.score` desc, ties broken by `name` asc for determinism) → partition into `risky`
  (`tier !== 'low'`) and `low` (`tier === 'low'`). Pre-bakes everything the UI renders so the render
  layer carries no logic.
- **Deps:** `scoring/`. No `chrome.*`.

### 3.2 `popup/render.ts` — view (dumb glue)

- **Purpose:** map a `ReportView` (+ injected C1 warnings) to DOM. No decisions beyond a static
  `tier → css-class/label` lookup. Left for Phase 8 in-browser testing precisely because it is dumb.

### 3.3 `popup/index.ts` — controller (glue)

- **Behavior:** on open → `getExtensions()` → `buildReport` → `render` → wire action buttons. Then,
  for each **risky** card, call `getPermissionWarningsById(id)` and fill its warning line when it
  resolves (progressive — the popup paints immediately; a slow/failed warning call leaves the card
  intact without it). Low-risk rows fetch no warnings.
- **Deps:** `report/`, `management/`, `popup/render.ts`.

### 3.4 `management/` — edge (extended)

Add three thin `chrome.management` wrappers alongside the existing `getExtensions()`:
- `getPermissionWarningsById(id: string): Promise<string[]>` — the browser's own warnings (C1).
- `setEnabled(id: string, enabled: boolean): Promise<void>` — Disable/Enable toggle.
- `uninstall(id: string): Promise<void>` — triggers Chrome's **native confirmation dialog**.

## 4. Types (additions to `src/types.ts`)

```ts
export interface ReportCard {
  id: string;
  name: string;
  version: string;
  tier: Tier;          // 'critical' | 'high' | 'medium' (cards are tier ≥ medium)
  score: number;       // [0,1]
  reasons: string[];   // plain-English, from scoreExtension
  enabled: boolean;
  canDisable: boolean; // = mayDisable
}

export interface ReportRow {
  id: string;
  name: string;
  tier: Tier;          // 'low'
  enabled: boolean;
  canDisable: boolean;
}

export interface ReportView {
  grade: FleetGrade;             // { grade: 'A'..'F', score }
  risky: ReportCard[];           // worst-first
  low: ReportRow[];              // worst-first
  counts: { total: number; risky: number; low: number };
}
```

## 5. Visual & copy

- **Header:** the A–F grade (large) + a one-line summary ("3 need a look · 9 low-risk"). Answers the
  2-second test.
- **Tiers:** dot + text label + color, never color alone (accessibility/contrast). `critical` = red,
  `high` = amber, `medium` = yellow, `low` = neutral/gray. Red reserved for critical to avoid fatigue.
- **Risky card:** tier badge, name, plain-English reasons (capability-framed), the browser's C1
  warning line (verbatim, when available), and `[Disable]` / `[Remove]`.
- **Low row:** tier dot + name + a small action affordance (Disable/Remove via a `⋯` menu or inline).
- **Honest-limits footer (static constant):** *"Ext-Ray flags what an extension can do, not proof
  it's malicious — and can't see its code or network activity."*

## 6. Actions

- **Disable/Enable:** `setEnabled(id, !enabled)`; reversible and low-risk, so **no confirm** — update
  the card/row state in place (button label + a muted "disabled" visual). A full re-score waits for
  the next open (keeps the interaction simple).
- **Remove:** `uninstall(id)` → Chrome shows its native confirm dialog (spec §5.5). On success, drop
  the card/row from the view.
- **Managed (`mayDisable === false`):** both actions greyed/disabled + "managed by your organization".

## 7. States (boundaries only)

- **Empty:** no other extensions → friendly "No other extensions installed." (grade still renders, = A).
- **Managed:** per-item, actions disabled as above.
- **Error:** `getExtensions()` throws/unavailable → a graceful "Couldn't read your extensions" message,
  no crash.

## 8. Testing (TDD)

- **Pure `buildReport` is the target:** worst-first ordering (score desc, name tiebreak); risky/low
  partition exactly at the medium boundary; grade matches `gradeFleet`; counts; reasons passed through;
  empty fleet → grade A, empty lists; determinism (same input → same `ReportView`).
- **`management/` wrappers:** light tests with the in-memory chrome fake — `getPermissionWarningsById`
  returns the array, `setEnabled`/`uninstall` call through with the right args (and the fake omits
  nothing that would let an unintended API slip by).
- **Render + CSS + action wiring:** exercised in **Phase 8** (Playwright, real browser). Kept logic-free
  so this is safe; `render` is a pure data→DOM map.

## 9. Scope / non-goals (YAGNI)

- No UI framework, no CSS framework, no new runtime dependencies.
- No `notifications.onClicked` → open-popup wiring (deferred follow-up; touches the SW).
- No live re-scan/refresh button (the popup re-scores on each open); no settings (Phase 7).
- No on-device AI explanations (Phase 10).
- Disable does not trigger an immediate re-score of the whole fleet — next open reflects it.
