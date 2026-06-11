# Ext-Ray

**Audit the security of your _other_ browser extensions — entirely on your own device.**

Ext-Ray is a local-only Chrome/Edge (Manifest V3) extension that inspects every other
extension you have installed, grades its security risk in plain English, and quietly
watches for anything that changes _after_ you install it. No backend. No accounts.
Nothing leaves your browser.

> **Status:** Submission-ready (Phases 0–9.5 ✅) — scoring, snapshot-diff guardian, popup report
> with ring-gauge grade + real extension icons, options page, first-run onboarding, a shared
> OKLCH design system, MV3 build pipeline, a real-Chromium Playwright E2E suite
> (93 unit + 16 e2e tests), store screenshots (`npm run shots`), and the `docs/store/` submission
> kit. Remaining steps are owner-external (see
> [docs/store/submission-checklist.md](docs/store/submission-checklist.md)).
> See [docs/ROADMAP.md](docs/ROADMAP.md) for live status and the
> [design spec](docs/superpowers/specs/2026-06-05-ext-ray-design.md) for the architecture.
>
> On install, Ext-Ray opens a one-time onboarding page explaining its read-only, 100 %-on-device
> model and why it needs the `management` permission. Privacy policy:
> <https://junnythemarksman.github.io/ext-ray-privacy/>.

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

## Architecture

The whole product is **two pure engines** (`scoring`, `snapshot`) wrapped in thin browser
glue. All real logic is I/O-free and unit-testable; the messy `chrome.*` API surface is
kept at the edges.

```mermaid
flowchart TD
    subgraph UI["UI surfaces"]
        POP["popup — report & risk cards"]
        OPT["options — guardian settings"]
    end

    subgraph BG["background (service worker)"]
        SW["event + alarm wiring"]
    end

    subgraph CORE["pure engines — no I/O, unit-tested"]
        SCORE["scoring — scoreExtension / gradeFleet"]
        DIFF["snapshot — diff"]
    end

    STORE["storage — chrome.storage.local wrapper"]

    subgraph EDGE["chrome.* APIs — the only side effects"]
        MGMT["chrome.management"]
        ALARM["chrome.alarms"]
        NOTIF["chrome.notifications"]
        STG["chrome.storage"]
    end

    POP --> SCORE
    POP --> MGMT
    OPT --> STORE
    SW --> SCORE
    SW --> DIFF
    SW --> STORE
    SW --> MGMT
    SW --> ALARM
    SW --> NOTIF
    STORE --> STG
```

## Deployment

Build once with Vite, publish to the stores, run inside the browser. There is **no server
anywhere in the picture** — Ext-Ray reads other extensions' metadata locally and contacts
nothing.

```mermaid
flowchart LR
    subgraph DEV["Developer machine"]
        direction TB
        SRC["TypeScript source"]
        VITE["Vite build"]
        DIST["dist/ — MV3 bundle"]
        SRC --> VITE --> DIST
    end

    DIST -->|upload| CWS["Chrome Web Store / Edge Add-ons"]
    CWS -->|"install & auto-update"| BROWSER

    subgraph BROWSER["User's browser — Chrome / Edge"]
        direction TB
        EXT["Ext-Ray"]
        OTHERS["the user's other installed extensions"]
        EXT -->|"reads metadata via chrome.management"| OTHERS
    end

    NET["No backend · no accounts · no telemetry"]
    EXT -. "nothing leaves the device" .-> NET
```

## Data flow

### On-demand audit (the popup)

```mermaid
sequenceDiagram
    actor User
    participant Popup as popup
    participant Mgmt as chrome.management
    participant Score as scoring engine

    User->>Popup: open Ext-Ray
    Popup->>Mgmt: getAll()
    Mgmt-->>Popup: installed extensions
    loop for each extension
        Popup->>Score: scoreExtension(info)
        Score-->>Popup: tier + reasons
    end
    Popup->>Score: gradeFleet(verdicts)
    Score-->>Popup: overall grade (A–F)
    Popup-->>User: grade + risk cards, worst first
    User->>Popup: click Disable / Remove
    Popup->>Mgmt: setEnabled() / uninstall()
    Note over Popup,Mgmt: uninstall shows Chrome's native confirm dialog
```

### Background guardian (continuous monitoring)

```mermaid
sequenceDiagram
    participant Trig as Trigger
    participant SW as Service worker
    participant Mgmt as chrome.management
    participant Store as Storage
    participant Diff as Diff engine
    participant Notif as chrome.notifications

    Trig->>SW: install event or alarm tick
    SW->>Mgmt: getAll()
    Mgmt-->>SW: current extensions
    SW->>Store: load previous snapshot
    Store-->>SW: previous snapshot
    SW->>Diff: diff(previous, current)
    Diff-->>SW: changes[]
    alt meaningful change found
        SW->>Notif: notify the user
    else nothing changed
        SW-->>SW: stay silent
    end
    SW->>Store: persist new snapshot
```

### What counts as a "meaningful change"

The guardian deliberately fires on **any silent change after install**, not just new
permissions — because the largest 2024–25 attacks added _no_ new permissions and instead
weaponized already-trusted extensions via an update.

```mermaid
flowchart TD
    SCAN["re-scan: getAll() + diff vs. last snapshot"] --> Q{"meaningful change?"}
    Q -->|new extension installed| A["alert: new install"]
    Q -->|permissions added| B["alert: permission change"]
    Q -->|"version jump after long stability"| C["alert: suspicious update"]
    Q -->|"publisher / updateUrl changed"| D["alert: possible ownership change"]
    Q -->|no change| E["stay silent · update snapshot"]
```

## Security & trust model

Everything happens on your device, behind the smallest permission footprint that can do
the job. Ext-Ray is also honest about its limits: it reads what an extension _declares_,
not what its code _does_.

```mermaid
flowchart TB
    subgraph DEVICE["Your device — all processing happens here"]
        EXT["Ext-Ray"]
        subgraph PERMS["only 4 permissions — none are host permissions"]
            P1["management"]
            P2["storage"]
            P3["alarms"]
            P4["notifications"]
        end
        CAN["CAN see: declared permissions, install source, version, enabled state"]
        CANT["CANNOT see: extension code, network or page behavior, your browsing data"]
        EXT --- PERMS
        EXT --- CAN
        EXT --- CANT
    end

    NET["No backend · no accounts · no telemetry"]
    EXT -. "no data leaves the device" .-> NET
```

- Requests exactly **four permissions, none of them host permissions**:
  `management`, `storage`, `alarms`, `notifications`.
- **No** `<all_urls>`, no page/content access, no network calls to any server.
- **Read-only** by default — it never disables or removes anything without your click.
- It honestly tells you its limit: a high risk tier means an extension **can** do
  something powerful, **not** that it is malicious — most popular, trusted extensions
  legitimately hold broad permissions. Ext-Ray reads _declared_ permissions and install
  state, and **cannot** see an extension's actual code, the pages it injects, its network
  traffic, which permissions it truly uses vs. merely declares, or behavior hidden behind
  a trigger. It flags capability and silent change — never proven malice.

## Scope

**In:** Chromium (Chrome + Edge), local-only analysis, on-demand audit, the background
guardian, user-initiated disable/uninstall.

**Out (for now):** any backend/accounts, Firefox/Safari, automatic blocking/enforcement,
a malicious-extension reputation database, and code/behavioral analysis.

## Development

Vanilla TypeScript + Vite, minimal dependencies (a security tool shouldn't ship a large
dependency tree). Build/run instructions land with the first implementation milestone.

## Donations

Ext-Ray is free, local-only, and has nothing to sell. If it's useful to you, a Bitcoin
donation helps keep it maintained:

```
bc1qux0rkwceymkq6nzya8wzzamj0amus6l35pzeq2
```

(Also available under **Support Ext-Ray** at the bottom of the extension's options page.)
