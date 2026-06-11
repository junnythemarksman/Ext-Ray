# Ext-Ray UI Refresh — Design (Phase 9.5)

- **Date:** 2026-06-11
- **Status:** Approved design, pre-implementation
- **Author:** Genaro Peque, Jr
- **Elaborates:** owner brand art (logo + promo tiles, 2026-06-11); research workflow `wf_851386fa`
  (5 scouts + synthesis, primary-sourced 2024–26); main design spec §5.5–§5.6.

## 1. Summary

Restyle all three user surfaces (popup, options, onboarding) to the new brand language — dark navy,
desaturated cyan accents, an SVG ring gauge around the A–F grade with a word label, per-extension
cards with real extension icons and colored risk pills — implemented as one shared OKLCH token file
plus per-surface CSS, with **zero** new dependencies, **zero** network, **zero** new permissions, and
the existing XSS-safe `createElement`/`textContent` rendering discipline. After the restyle the
product, the store screenshots, and the owner's promo art all match, which also dissolves the
"promo art shows a stylized UI" review caveat.

## 2. Decisions (owner-approved 2026-06-11)

1. **All three surfaces** move to the new language in one phase.
2. **Real extension icons** on cards/rows. Research verdict (high confidence, primary-sourced):
   `chrome.management` `ExtensionInfo.icons[].url` (`chrome://extension-icon/…`) renders directly in
   `<img>` inside extension **pages** with the existing `management` permission — the MV3 chrome://
   fetch restriction is service-worker-only ([mgmt API](https://developer.chrome.com/docs/extensions/reference/api/management) 2025;
   [GoogleChrome/chrome-extensions-samples #1105](https://github.com/GoogleChrome/chrome-extensions-samples/pull/1105/files) 2024).
3. **Grade word labels:** A = Excellent · B = Good · C = Fair · D = Poor · F = At Risk (no "E" grade;
   never "Critical" as a grade word — it collides with the pill vocabulary). Convention cross-checked
   against Mozilla Observatory / SecurityHeaders grade phrasing.
4. **Grade-mapped arc color** (A green → F red via per-grade tokens), not always-cyan: red stays
   reserved for "worst," matching the severity system; the letter+word carry the information either
   way (a11y-safe).
5. **system-ui typography** (no bundled font). Revisit only if the build visibly clashes with the art.
6. **Pills and cards are not interactive** — buttons remain the only interactive elements.

## 3. Architecture

### 3.1 `shared/tokens.css` (new) — the design system

Two-layer OKLCH tokens, all `--er-` prefixed (primitives + semantic), `@import`ed as the first line
of `popup/popup.css`, `options/options.css`, `onboarding/onboarding.css` (Vite inlines `@import` at
build; no runtime fetch). Contents:

- **Primitives:** navy ramp (`--er-navy-0` ≈ oklch(0.18 0.04 260) base page, surfaces derived via
  relative color syntax `oklch(from … calc(l + 0.05/0.08) c h)`), accent cyan
  `--er-accent: oklch(0.75 0.15 195)` (desaturated; ~#3EC9D6 class, AA on navy for large/heading
  text only), text ramp (near-white body ≥7:1, muted ≥4.5:1).
- **Severity tokens** (desaturated for dark navy, tiers ≥20 L apart, never red-vs-green as the
  Low/Critical pair): `--er-critical` ≈ #E03030-class red (worst only), `--er-high` amber-orange
  ≈ #E07800, `--er-medium` gold ≈ #C8A800, `--er-low` teal/sky ≈ #2DCCFF-class. The current
  `--low` slate `#64748b` fails 3:1 on panel — replaced.
- **Grade tokens:** `--er-grade-a` (green) … `--er-grade-f` (= `--er-critical` red).
- **Elevation:** tonal lightness steps + `border: 1px solid oklch(1 0 0 / 0.10)` — never dark
  box-shadows on navy. Hover glow (two-layer box-shadow: 1px ring + diffuse halo) reserved for
  High/Critical cards, gated `prefers-reduced-motion` for any movement.
- **A11y blocks:** `:focus-visible` 2px accent outline + offset everywhere interactive;
  `@media (forced-colors: active)` mapping borders/outlines to system colors (glows are decoration,
  never the contrast boundary); motion **opt-in** via `@media (prefers-reduced-motion: no-preference)`.
- **Contrast gates (verify at implementation with WebAIM/axe math):** body text ≥4.5:1 on its
  surface; pill label ≥4.5:1 on pill fill; pill fill + card borders + ring track ≥3:1 on adjacent
  surface; cyan never used for <18px body copy.

### 3.2 Popup (`popup/render.ts`, `popup/popup.css`, `popup/index.html`)

- **Header:** 20px brand logo `<img src="../icons/icon-32.png">` + "Ext-Ray" + summary line, and the
  **ring gauge** replacing the flat grade square:
  - Inline SVG (`createElementNS`), viewBox 100×100, r=45: track circle (low-opacity stroke) +
    progress circle, `stroke-linecap="round"`, rotated −90°; `stroke-dasharray = 2πr ≈ 282.74`;
    fill represents **safety**: `strokeDashoffset = C × grade.score` (A/score 0 → full ring,
    F/score 1 → empty-ish; clamp a 0.04×C minimum visible arc so F isn't an invisible ring) set via
    `el.style.setProperty` (CSP-safe).
  - Arc + glow color from `--er-grade-<letter>`; glow = `filter: drop-shadow` on a `<g>` wrapping
    only the progress circle (box-shadow would halo the SVG rect).
  - Centered overlay: letter span — **keeps `class="grade grade-<letter>"`** (e2e contract:
    `toHaveText('F')`, `toHaveClass(/grade-f/)`) — plus new `.grade-word` span (Excellent…At Risk)
    and "Overall security grade" microcopy.
  - Wrapper: `role="meter"`, `aria-valuemin="0"` `aria-valuemax="100"`
    `aria-valuenow="<round((1-score)*100)>"`, `aria-valuetext="F – At Risk"`,
    `aria-labelledby` → the letter span's id; SVG `aria-hidden="true"`.
  - `GRADE_WORDS: Record<Grade, string>` lives beside the existing `TIER_LABEL` map in render.ts
    (static label lookup — established precedent; no logic added to render).
- **Cards** (`article.card.tier-*` retained): leading 32px icon box —
  `<img class="ext-icon" width="32" height="32">`, `src = card.iconUrl ?? FALLBACK`, plus an
  `error` listener swapping to FALLBACK (`../icons/ext-fallback.svg`, new bundled brand-colored
  silhouette); disabled composes existing `.is-disabled` with `filter: grayscale(1) opacity(.45)`
  on the icon. Name/version/reasons/`.js-warning`/actions unchanged in structure. `.tier-label`
  **becomes the pill** (same class + text, restyled: inline-flex, radius 9999px, tier-hue fill/
  border/text via one `--pill-hue`-style token per tier) — color + text + the existing left-border
  accent = three redundant cues.
- **Low rows:** icon (24px) + name + Low pill + actions; same selectors.
- **Footer:** honest-limits text content unchanged; restyled only.

### 3.3 Icon plumbing (pure + edge; the only `src/` changes)

- `src/types.ts`: `ExtSnapshot.iconUrl?: string`; `ReportCard.iconUrl?: string`;
  `ReportRow.iconUrl?: string`. **Additive-optional** — stored snapshots without it render the
  fallback; **no schema migration** (schemaVersion stays 1). `diff()` untouched (iconUrl is not a
  tracked-change field; chrome-internal URLs may churn and must never produce Change events).
- `src/management/management.ts`: export pure
  `pickBestIcon(icons: Array<{ size: number; url: string }> | undefined, target: number): string | undefined`
  — sort ascending, first `size ≥ target`, else largest, else undefined (per the research caveats:
  never `icons[0]`, always null-guard; never hand-construct chrome:// URLs). `normalize()` adds
  `iconUrl: pickBestIcon(e.icons, 48)` (48px source → 32px box for HiDPI).
- `src/report/report.ts`: plumb `iconUrl` through to cards/rows.
- **Unit tests (TDD):** `pickBestIcon` (undefined, empty, exact, between-sizes, all-smaller cases);
  report plumb-through. Render/SVG stays e2e-covered (project pattern: dumb render not unit-tested).

### 3.4 Options + onboarding

- `options/options.css`: tokens; controls/checkboxes/select/donation section restyled (accent
  checkboxes via `accent-color`, pill-styled Copy button); structure + all `data-*` selectors
  unchanged. 420px width retained (e2e overflow test must stay green).
- `onboarding/index.html` + `onboarding.css`: brand hero (icon-128 logo, title, tagline), the three
  `.point` cards restyled with leading circular check icons (inline SVG/CSS, brand accent), footer
  restyled. **Text content and selectors (`h1`, `.point`, `.point h2`, `.foot a`, `#done`)
  unchanged** — e2e contract.

### 3.5 Out of scope

Engine/scoring/guardian behavior, weights, manifest, permissions, fonts, framework, interactive
cards/pills, popup width changes, i18n.

## 4. Testing & verification

- All existing **86 unit + 14 e2e green, unmodified assertions** (selectors deliberately preserved;
  the only e2e file changes are *additions*: popup spec asserts `.ext-icon` images render with the
  fallback for the iconless fixtures, and `.grade-word` shows "At Risk" for the F fleet).
- New unit tests: `pickBestIcon` ×5, report `iconUrl` plumb ×2.
- `npm run verify:build` (4-permission invariant must still pass — restyle adds no permission).
- **Visual checkpoint before merge:** rendered popup/options/onboarding screenshots presented for
  owner eyeball against the brand art.
- Close-out: regenerate `npm run shots`, copy to the desktop screenshots folder, refresh the desktop
  ZIP + unpacked folder (owner's installed copy), ROADMAP "Phase 9.5" entry.

## 5. Honest limitations

- The e2e fixtures declare no icons, so in-suite assertions exercise the **fallback** path; the
  real-icon path (`chrome://extension-icon/…`) is verified by a manual smoke in the owner's Chrome
  (their real fleet) — the research's one medium-confidence area (internal URL format stability)
  is mitigated by only ever using API-returned URL strings.
- Store screenshots are generated over the fixture fleet (icons = fallback silhouettes); the
  listing note about `installType: development` tier inflation continues to apply.
