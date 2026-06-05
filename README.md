# Ext-Ray

**Audit the security of your _other_ browser extensions — entirely on your own device.**

Ext-Ray is a local-only Chrome/Edge (Manifest V3) extension that inspects every other
extension you have installed, grades its security risk in plain English, and quietly
watches for anything that changes _after_ you install it. No backend. No accounts.
Nothing leaves your browser.

> **Status:** Design phase — see the [design spec](docs/superpowers/specs/2026-06-05-ext-ray-design.md).
> No implementation code yet.

## Why it exists

Most people run 8–12 extensions but actively use only 2–3. The forgotten ones keep their
permissions — and the biggest real-world extension attacks of 2024–25 weaponized
_trusted_ extensions via a silent auto-update. Ext-Ray gives you a one-click read on
which of your extensions are risky and why, and warns you when one changes.

## How it works (in one breath)

Open the popup → see an overall security grade plus a card for each extension (risk tier,
plain-English reasons, one-click **Disable** / **Remove**). In the background, a guardian
re-scans on a timer and on install events, and notifies you when an extension is newly
installed or **silently changes** after install (new permissions, a version bump after
long stability, or a publisher change).

## Trust posture

- Requests exactly **four permissions, none of them host permissions**:
  `management`, `storage`, `alarms`, `notifications`.
- **No** `<all_urls>`, no page/content access, no network calls to any server.
- **Read-only** by default — it never disables or removes anything without your click.
- It honestly tells you its limit: it reads _declared_ permissions and install state,
  **not** an extension's code or network behavior.

## Scope

**In:** Chromium (Chrome + Edge), local-only analysis, on-demand audit, the background
guardian, user-initiated disable/uninstall.

**Out (for now):** any backend/accounts, Firefox/Safari, automatic blocking/enforcement,
a malicious-extension reputation database, and code/behavioral analysis.

## Development

Vanilla TypeScript + Vite, minimal dependencies (a security tool shouldn't ship a large
dependency tree). Build/run instructions land with the first implementation milestone.
