// background/ — the MV3 service worker (design spec §3.3). Thin glue only:
// wiring + I/O. All decisions are in the pure guardian core. Date.now() lives
// here (the edge), never in the pure core. Integration-tested in Phase 8.

import { getExtensions } from '../management/management';
import { evaluateScan } from '../guardian/guardian';
import { getSnapshot, setSnapshot, getTimestamps, setTimestamps, getSettings, getIgnored, migrate } from '../storage/storage';
import { trace } from '../debug';

const ALARM_NAME = 'extray-scan';
const tPerf = trace('perf.guardian');

// Serialize scans: an in-flight scan finishes before the next starts, so a
// near-simultaneous event + alarm tick can't race the snapshot read/persist (spec §6).
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

async function ensureAlarm(): Promise<void> {
  if (await chrome.alarms.get(ALARM_NAME)) return;
  const { scanIntervalMinutes } = await getSettings();
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: scanIntervalMinutes });
}

async function init(): Promise<void> {
  await migrate();
  await ensureAlarm();
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
