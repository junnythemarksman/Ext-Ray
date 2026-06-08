// background/ — the MV3 service worker (design spec §3.3, Phase 7 §3.2). Thin glue:
// wiring + I/O. All decisions live in the pure guardian core (evaluateScan, reconcileAlarm).
// Date.now() lives here (the edge), never in the pure core. Integration-tested in Phase 8.

import { getExtensions } from '../management/management';
import { evaluateScan } from '../guardian/guardian';
import { reconcileAlarm } from '../guardian/alarm';
import { getSnapshot, setSnapshot, getTimestamps, setTimestamps, getSettings, getIgnored, migrate } from '../storage/storage';
import { trace } from '../debug';
import type { AlarmAction } from '../types';

const ALARM_NAME = 'extray-scan';
const tPerf = trace('perf.guardian');

// Serialize scans: an in-flight scan finishes before the next starts (spec §6).
let inFlight: Promise<void> = Promise.resolve();
function scheduleScan(): Promise<void> {
  inFlight = inFlight.catch(() => undefined).then(runScan);
  return inFlight;
}

async function runScan(): Promise<void> {
  const start = Date.now();
  const [curr, prev, timestamps, settings, ignored] = await Promise.all([
    getExtensions(), getSnapshot(), getTimestamps(), getSettings(), getIgnored(),
  ]);
  if (!settings.monitoringEnabled) return;

  const result = evaluateScan({ prev, curr, timestamps, settings, ignored, now: Date.now() });
  if (result.notification) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title: result.notification.title,
      message: result.notification.message,
    });
  }
  await Promise.all([setSnapshot(curr), setTimestamps(result.timestamps)]);
  if (tPerf.enabled) tPerf('scan complete', { ms: Date.now() - start, count: curr.length });
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
chrome.runtime.onInstalled.addListener(() => void init());
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === ALARM_NAME) void scheduleScan(); });
chrome.management.onInstalled.addListener(() => void scheduleScan());
chrome.management.onEnabled.addListener(() => void scheduleScan());
chrome.management.onDisabled.addListener(() => void scheduleScan());
chrome.management.onUninstalled.addListener(() => void scheduleScan());
// Settings changed (from the options page) → re-reconcile the alarm so it takes effect live.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.settings) void reconcileAlarmNow();
});
