# Ext-Ray — Chrome Web Store listing (copy-paste source)

All text below is written against the 2025–26 CWS policies: accurate claims only, zero
superlatives, every claim implemented in the submitted build. Sources:
[program policies](https://developer.chrome.com/docs/webstore/program-policies/policies),
[dashboard privacy](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy) (2025).

## Name
Ext-Ray

## Short description (≤132 chars)
Audit the security of your other extensions — risk grades, plain-English reasons, and
change alerts. 100% on-device.

## Full description
Ext-Ray inspects every extension you have installed and grades its security risk — entirely
on your own device.

WHAT IT DOES
• Risk report: an A–F grade for your whole extension set, with a card per risky extension
  explaining, in plain English, what it *could* do (e.g. "Can read and change your data on
  all websites") — including Chrome's own warning text for that extension.
• Change guardian: Ext-Ray remembers a snapshot of each extension's declared permissions and
  version, re-scans in the background, and notifies you when something changes silently —
  the pattern behind the major real-world extension attacks of 2024–26, where a trusted
  extension turns malicious through a quiet update.
• One-click response: disable or remove a risky extension from the report (removal always
  goes through Chrome's own confirmation dialog).

WHAT IT DOES NOT DO
• No data collection. No servers, accounts, analytics, or telemetry. Ext-Ray makes zero
  network requests; nothing you do leaves your browser.
• No code or traffic inspection. Ext-Ray reads only the metadata extensions declare
  (permissions, version, install source). A high grade means an extension *can* do risky
  things — it is not proof of malice, and Ext-Ray says so in the report.
• Read-only by default. Ext-Ray never changes another extension without your click.

PERMISSIONS, PLAINLY
• "Manage your apps, extensions, and themes" — this is the read access that makes the audit
  possible. • Storage — your settings and the latest snapshot, kept locally. • Alarms — the
  background re-scan schedule. • Notifications — change alerts.

Privacy policy: https://junnythemarksman.github.io/ext-ray-privacy/

## Category
Tools (owner confirms in dashboard)

## Dashboard — Privacy practices tab (paste-ready)

**Single purpose:**
Audits the security and privacy risk of the user's installed Chrome extensions entirely
on-device, read-only, with no data collection or network transmission.

**Permission justifications:**
- management: Read-only enumeration of installed extensions (chrome.management.getAll) and
  Chrome's own warning text (getPermissionWarningsById) to compute risk scores on-device.
  setEnabled/uninstall are invoked only when the user explicitly clicks Disable/Remove on a
  specific extension; uninstall always shows Chrome's native confirmation dialog.
- storage: Persists user settings and the most recent extension-metadata snapshot locally
  (chrome.storage.local) so changes can be detected between scans. Nothing is transmitted.
- alarms: Schedules the periodic background re-scan chosen in the options page.
- notifications: Alerts the user when a scan detects a suspicious change (e.g. an extension
  silently gaining host access).

**Remote code:** No, I am not using remote code.
**Data types collected:** none (leave every checkbox unchecked).
**Limited Use certification:** certify — trivially satisfied; no data is collected or shared.

## Screenshots (1280×800, generated from the real UI)
Run `npm run shots` → `shots/popup-1280x800.png`, `shots/options-1280x800.png`,
`shots/onboarding-1280x800.png`. NOTE before uploading: the screenshot fleet is loaded
unpacked, so extensions carry a small "installed outside the Web Store (development)" bump
and reason line; reviewers compare screenshots to behavior, and these ARE real behavior —
but the owner should eyeball each capture (and may retake on a real fleet) before upload.
