// background/ — the MV3 service worker (design spec §3.3, Phase 7 §3.2). Thin glue:
// wiring + I/O. All decisions live in the pure guardian core (evaluateScan, reconcileAlarm).
// Date.now() lives here (the edge), never in the pure core. Integration-tested in Phase 8.

import { getExtensions } from '../management/management';
import { evaluateScan, isUntrustworthyScan } from '../guardian/guardian';
import { reconcileAlarm } from '../guardian/alarm';
import { getSnapshot, setSnapshot, getTimestamps, setTimestamps, getSettings, getTrusted, setTrusted, migrate } from '../storage/storage';
import { trace } from '../debug';
import type { AlarmAction } from '../types';

const ALARM_NAME = 'extray-scan';
const tPerf = trace('perf.guardian');
const tSec = trace('sec.guardian');

// Serialize scans: an in-flight scan finishes before the next starts (spec §6).
let inFlight: Promise<void> = Promise.resolve();
function scheduleScan(): Promise<void> {
  inFlight = inFlight.catch(() => undefined).then(runScan);
  return inFlight;
}

async function runScan(): Promise<void> {
  const start = Date.now();
  try {
    const [curr, prev, timestamps, settings, trusted] = await Promise.all([
      getExtensions(), getSnapshot(), getTimestamps(), getSettings(), getTrusted(),
    ]);
    if (!settings.monitoringEnabled) return;

    // A transient empty read (getExtensions() racing SW/profile init) must not rebase the baseline
    // to []. Skip entirely — no evaluate, notify, or persist — keeping the prior snapshot.
    if (isUntrustworthyScan(prev, curr)) {
      if (tSec.enabled) tSec('skipped suspect empty scan', { prevCount: prev.length });
      return;
    }

    const result = evaluateScan({ prev, curr, timestamps, settings, trusted, now: Date.now() });

    // (b) Notify BEFORE persist = at-least-once delivery. If the SW is killed in the sub-second
    // window between create() and the snapshot write, the next scan re-diffs against the old
    // snapshot and re-shows ONE notification (a benign duplicate). Reordering would instead drop
    // the alert silently (snapshot already current), the wrong failure mode for a security tool.
    if (result.notification) {
      // (c) A missing icon asset (or any create failure) must never crash the SW.
      chrome.notifications
        .create({
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
          title: result.notification.title,
          message: result.notification.message,
        })
        .catch((e) => { if (tSec.enabled) tSec('notify failed', { error: String(e) }); });
    }
    const writes: Array<Promise<void>> = [setSnapshot(curr), setTimestamps(result.timestamps)];
    if (result.revokeTrust.length) {
      const revoke = new Set(result.revokeTrust);
      writes.push(setTrusted(trusted.filter((id) => !revoke.has(id))));
      if (tSec.enabled) tSec('trust revoked (material change)', { ids: result.revokeTrust.length });
    }
    await Promise.all(writes);
    if (tPerf.enabled) tPerf('scan complete', { ms: Date.now() - start, count: curr.length });
  } catch (e) {
    // (a) A failing scan must never become a terminal unhandled rejection in the inFlight chain.
    if (tSec.enabled) tSec('scan failed', { error: String(e) });
  }
}

async function applyAlarmAction(action: AlarmAction): Promise<void> {
  if (action.kind === 'clear') await chrome.alarms.clear(ALARM_NAME);
  else if (action.kind === 'create') chrome.alarms.create(ALARM_NAME, { periodInMinutes: action.periodInMinutes });
}

// Bring the scan alarm in line with the current settings (create / clear / leave).
async function reconcileAlarmNow(): Promise<void> {
  const [settings, existing] = await Promise.all([getSettings(), chrome.alarms.get(ALARM_NAME)]);
  await applyAlarmAction(reconcileAlarm(settings, existing));
}

async function init(): Promise<void> {
  await migrate();
  await reconcileAlarmNow();
  await scheduleScan();
}

// Listeners registered synchronously at top level (MV3 requirement, spec §4.4).
chrome.runtime.onStartup.addListener(() => void init());
chrome.runtime.onInstalled.addListener((details) => {
  void init();
  // First-run onboarding (Phase 9): once per INSTALL only — never on update/reload.
  // tabs.create needs no permission; a failure must never break init.
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding/index.html') })
      .catch((e) => { if (tSec.enabled) tSec('onboarding open failed', { error: String(e) }); });
  }
});
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === ALARM_NAME) void scheduleScan(); });
chrome.management.onInstalled.addListener(() => void scheduleScan());
chrome.management.onEnabled.addListener(() => void scheduleScan());
chrome.management.onDisabled.addListener(() => void scheduleScan());
chrome.management.onUninstalled.addListener(() => void scheduleScan());
// Settings changed (from the options page) → re-reconcile the alarm so it takes effect live.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.settings) void reconcileAlarmNow();
});

// (d) Clicking a change notification opens the report. chrome.action.openPopup() can reject
// without an active window/user gesture → fall back to opening the popup page in a tab. No new
// permission: tabs.create needs no "tabs" permission, and the action is already declared.
chrome.notifications.onClicked.addListener(() => {
  chrome.action.openPopup().catch(() => {
    void chrome.tabs.create({ url: chrome.runtime.getURL('popup/index.html') });
  });
});

// (a) Last-resort net: a rejected promise from any void-ed async (init, scheduleScan) is logged,
// never a silent terminal unhandled rejection. (WindowEventMap in the DOM lib already types
// 'unhandledrejection' as PromiseRejectionEvent — no tsconfig lib change needed.)
self.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
  if (tSec.enabled) tSec('unhandled rejection', { reason: String(e.reason) });
});
