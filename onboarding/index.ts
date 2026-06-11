// onboarding/ — first-run page (design spec Phase 9 §3.1). Static content; this module
// exists only because MV3 extension-page CSP forbids inline handlers. window.close()
// works without any chrome.* API because the service worker opened this tab.
document.getElementById('done')?.addEventListener('click', () => window.close());
