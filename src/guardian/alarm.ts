// guardian/alarm.ts — pure alarm-reconciliation decision (design spec §3.1). No I/O.
// Given the current settings and the existing scan alarm (if any), decide whether to
// leave it, clear it, or (re)create it. The service worker performs the chrome.alarms
// effect; this function just decides. Clamps to Chrome's 0.5-minute minimum period.

import type { Settings, AlarmAction } from '../types';

const MIN_PERIOD_MINUTES = 0.5; // Chrome 120+ will not honor a shorter alarm period

export function reconcileAlarm(
  settings: Settings,
  existing: { periodInMinutes?: number } | undefined,
): AlarmAction {
  if (!settings.monitoringEnabled) {
    return existing ? { kind: 'clear' } : { kind: 'none' };
  }
  const periodInMinutes = Math.max(MIN_PERIOD_MINUTES, settings.scanIntervalMinutes);
  if (!existing || existing.periodInMinutes !== periodInMinutes) {
    return { kind: 'create', periodInMinutes };
  }
  return { kind: 'none' };
}
