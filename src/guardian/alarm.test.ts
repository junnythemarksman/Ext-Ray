import { describe, it, expect } from 'vitest';
import type { Settings } from '../types';
import { reconcileAlarm } from './alarm';

const settings = (o: Partial<Settings> = {}): Settings => ({
  monitoringEnabled: true, scanIntervalMinutes: 5, notify: true, ...o,
});

describe('reconcileAlarm', () => {
  it('clears the alarm when monitoring is off and one exists', () => {
    expect(reconcileAlarm(settings({ monitoringEnabled: false }), { periodInMinutes: 5 })).toEqual({ kind: 'clear' });
  });

  it('does nothing when monitoring is off and no alarm exists', () => {
    expect(reconcileAlarm(settings({ monitoringEnabled: false }), undefined)).toEqual({ kind: 'none' });
  });

  it('creates the alarm when monitoring is on and none exists', () => {
    expect(reconcileAlarm(settings({ scanIntervalMinutes: 5 }), undefined)).toEqual({ kind: 'create', periodInMinutes: 5 });
  });

  it('recreates the alarm when the period no longer matches', () => {
    expect(reconcileAlarm(settings({ scanIntervalMinutes: 15 }), { periodInMinutes: 5 })).toEqual({ kind: 'create', periodInMinutes: 15 });
  });

  it('does nothing when monitoring is on and the period already matches', () => {
    expect(reconcileAlarm(settings({ scanIntervalMinutes: 5 }), { periodInMinutes: 5 })).toEqual({ kind: 'none' });
  });

  it('clamps the period to Chrome\'s 0.5-minute minimum', () => {
    expect(reconcileAlarm(settings({ scanIntervalMinutes: 0.1 }), undefined)).toEqual({ kind: 'create', periodInMinutes: 0.5 });
  });
});
