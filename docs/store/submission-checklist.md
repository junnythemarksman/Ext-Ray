# Chrome Web Store submission checklist — owner-only steps

Everything the repo can produce is done (onboarding page, screenshots, listing copy,
privacy policy text). The steps below require the owner's accounts/identity and are listed
in execution order. Sources are 2025–26 CWS primary docs.

## One-time account setup
- [ ] Enable **2-Step Verification** on the publishing Google account — hard gate, no
      submission without it. [2SV policy](https://developer.chrome.com/docs/webstore/program-policies/two-step-verification)
- [ ] Pay the one-time **$5 developer registration fee** (if not already registered).
- [ ] Complete the **Trader / Non-Trader** declaration (EU DSA). Free, personal,
      non-monetized → Non-Trader is the likely fit; owner decides.
      [Trader disclosure](https://developer.chrome.com/docs/webstore/program-policies/trader-disclosure)

## Privacy plumbing
- [ ] **Create the `extray.support@gmail.com` address** (it does not exist yet) — it is the
      published contact on the privacy policy.
- [ ] **Enable GitHub Pages** on `ext-ray-privacy`: Settings → Pages → Deploy from branch →
      `main` / root. Verify https://junnythemarksman.github.io/ext-ray-privacy/ renders.
- [ ] Paste that URL into the dashboard's per-item **privacy policy** field.

## Dashboard fields (paste from docs/store/listing.md)
- [ ] Single-purpose statement; per-permission justifications; remote code = **No**;
      data-types = **none**; Limited-Use certification. The **Privacy Practices tab is a
      hard publishing gate** — incomplete fields block publishing and risk a 30-day warning.
      [Dashboard privacy](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)

## Package & verify
- [ ] `npm run verify:build` (enforces MV3 loadability + the exactly-4-permissions /
      no-host / module-SW trust invariant).
- [ ] **Test the exact ZIP you will upload**: zip `dist/`, load the packed ZIP in a clean
      profile, click through popup/options/onboarding. "Broken functionality" is the most
      common rejection.
- [ ] `npm run shots`; eyeball all three screenshots against the live extension before upload.

## Submission expectations
- [ ] `management` ⇒ **guaranteed manual review**; current backlog means **1–2+ weeks** —
      budget accordingly. [Review process](https://developer.chrome.com/docs/webstore/review-process)
- [ ] **One appeal per violation** (2025 rule): if rejected, fix everything first, appeal
      once, never preemptively. [2025 policy updates](https://developer.chrome.com/blog/cws-policy-updates-2025)
- [ ] **Verified CRX upload** is optional and binds an RSA key irreversibly — decide
      deliberately; losing the key strands the listing.
- [ ] Expectation: security tools are excluded from the store's "Featured" program.
