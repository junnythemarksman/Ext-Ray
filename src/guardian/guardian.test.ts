import { describe, it, expect } from 'vitest';
import type { ExtSnapshot, Change, ExtTimestamps, Settings } from '../types';
import { classifySeverity, evaluateScan, isUntrustworthyScan, STABILITY_WINDOW_DAYS, type ClassifyCtx } from './guardian';

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;

function ext(o: Partial<ExtSnapshot> = {}): ExtSnapshot {
  return {
    id: 'a'.repeat(32), name: 'X', version: '1.0.0', enabled: true, type: 'extension',
    installType: 'normal', permissions: [], hostPermissions: [], mayDisable: true, ...o,
  };
}
function ctx(curr: ExtSnapshot[], prevTs: Record<string, ExtTimestamps> = {}, now = NOW): ClassifyCtx {
  return { currById: new Map(curr.map((e) => [e.id, e])), prevTimestamps: prevTs, now };
}
const id = 'a'.repeat(32);

describe('classifySeverity', () => {
  it('host-scope expansion is high', () => {
    const c: Change = { kind: 'permissions-added', id, name: 'X', permissions: ['<all_urls>'] };
    expect(classifySeverity(c, ctx([ext()]))).toBe('high');
    const c2: Change = { kind: 'permissions-added', id, name: 'X', permissions: ['https://e.com/*'] };
    expect(classifySeverity(c2, ctx([ext()]))).toBe('high');
  });

  it('API-permission-only addition is notable', () => {
    const c: Change = { kind: 'permissions-added', id, name: 'X', permissions: ['cookies'] };
    expect(classifySeverity(c, ctx([ext()]))).toBe('notable');
  });

  it('publisher (updateUrl) change is high', () => {
    const c: Change = { kind: 'publisher-changed', id, name: 'X', from: 'a', to: 'b' };
    expect(classifySeverity(c, ctx([ext()]))).toBe('high');
  });

  it('version bump at or beyond the stability window is notable', () => {
    const c: Change = { kind: 'version-changed', id, name: 'X', from: '1', to: '2' };
    const prevTs = { [id]: { firstSeen: 0, lastVersionChange: NOW - STABILITY_WINDOW_DAYS * DAY } };
    expect(classifySeverity(c, ctx([ext()], prevTs))).toBe('notable');
  });

  it('version bump within the stability window is info (silent)', () => {
    const c: Change = { kind: 'version-changed', id, name: 'X', from: '1', to: '2' };
    const prevTs = { [id]: { firstSeen: 0, lastVersionChange: NOW - 59 * DAY } };
    expect(classifySeverity(c, ctx([ext()], prevTs))).toBe('info');
  });

  it('sideloaded/development install is high', () => {
    const c: Change = { kind: 'installed', id, name: 'X' };
    expect(classifySeverity(c, ctx([ext({ installType: 'sideload' })]))).toBe('high');
    expect(classifySeverity(c, ctx([ext({ installType: 'development' })]))).toBe('high');
  });

  it('normal install of a critical-tier extension is notable', () => {
    const c: Change = { kind: 'installed', id, name: 'X' };
    expect(classifySeverity(c, ctx([ext({ hostPermissions: ['<all_urls>'] })]))).toBe('notable');
  });

  it('normal install of a low-risk extension is info (silent)', () => {
    const c: Change = { kind: 'installed', id, name: 'X' };
    expect(classifySeverity(c, ctx([ext()]))).toBe('info');
  });

  it('capability decreases are info (silent)', () => {
    const removedPerm: Change = { kind: 'permissions-removed', id, name: 'X', permissions: ['cookies'] };
    const removedExt: Change = { kind: 'removed', id, name: 'X' };
    expect(classifySeverity(removedPerm, ctx([ext()]))).toBe('info');
    expect(classifySeverity(removedExt, ctx([]))).toBe('info');
  });

  it('normal install of a high-tier extension is notable', () => {
    const c: Change = { kind: 'installed', id, name: 'X' };
    // 'cookies' alone scores into the high tier (not critical) under a normal install
    expect(classifySeverity(c, ctx([ext({ permissions: ['cookies'] })]))).toBe('notable');
  });
});

const SETTINGS: Settings = { monitoringEnabled: true, scanIntervalMinutes: 5, notify: true };

describe('evaluateScan', () => {
  const A = 'a'.repeat(32), B = 'b'.repeat(32), C = 'c'.repeat(32);

  it('first run (empty prev) establishes a silent baseline — no notification', () => {
    const r = evaluateScan({
      prev: [], curr: [ext({ id: A, hostPermissions: ['<all_urls>'] })],
      timestamps: {}, settings: SETTINGS, trusted: [], now: NOW,
    });
    expect(r.notification).toBeNull();
    expect(r.classified).toEqual([]);
    expect(r.timestamps[A]).toEqual({ firstSeen: NOW, lastVersionChange: NOW });
  });

  it('suppresses info-level changes for trusted extensions', () => {
    // A version bump within the stability window is info; trusted extensions silence info churn.
    const r = evaluateScan({
      prev: [ext({ id: A, version: '1.0.0' })],
      curr: [ext({ id: A, version: '1.0.1' })],
      timestamps: { [A]: { firstSeen: 0, lastVersionChange: NOW - 1 } }, // recent → info
      settings: SETTINGS, trusted: [A], now: NOW,
    });
    expect(r.classified).toEqual([]);
    expect(r.notification).toBeNull();
    expect(r.revokeTrust).toEqual([]);
  });

  it('batches multiple noteworthy changes into one notification', () => {
    const r = evaluateScan({
      prev: [ext({ id: A }), ext({ id: B, updateUrl: 'http://old' })],
      curr: [ext({ id: A, hostPermissions: ['<all_urls>'] }), ext({ id: B, updateUrl: 'http://new' })],
      timestamps: { [A]: { firstSeen: 0, lastVersionChange: 0 }, [B]: { firstSeen: 0, lastVersionChange: 0 } },
      settings: SETTINGS, trusted: [], now: NOW,
    });
    expect(r.notification?.title).toBe('Ext-Ray: 2 changes need review');
  });

  it('stays silent when notifications are disabled, but still classifies + updates timestamps', () => {
    const r = evaluateScan({
      prev: [ext({ id: A })], curr: [ext({ id: A, hostPermissions: ['<all_urls>'] })],
      timestamps: { [A]: { firstSeen: 0, lastVersionChange: 0 } },
      settings: { ...SETTINGS, notify: false }, trusted: [], now: NOW,
    });
    expect(r.notification).toBeNull();
    expect(r.classified).toHaveLength(1);
  });

  it('updates timestamps: new id, version bump, carry-forward, and drops removed ids', () => {
    const r = evaluateScan({
      prev: [ext({ id: A, version: '1.0.0' }), ext({ id: B })],
      curr: [ext({ id: A, version: '2.0.0' }), ext({ id: C })],
      timestamps: { [A]: { firstSeen: 100, lastVersionChange: 100 }, [B]: { firstSeen: 200, lastVersionChange: 200 } },
      settings: SETTINGS, trusted: [], now: NOW,
    });
    expect(r.timestamps[A]).toEqual({ firstSeen: 100, lastVersionChange: NOW }); // bump
    expect(r.timestamps[C]).toEqual({ firstSeen: NOW, lastVersionChange: NOW }); // new
    expect(r.timestamps[B]).toBeUndefined();                                     // removed
  });

  it('is deterministic — same input, same result', () => {
    const input = {
      prev: [ext({ id: A })], curr: [ext({ id: A, hostPermissions: ['<all_urls>'] })],
      timestamps: { [A]: { firstSeen: 0, lastVersionChange: 0 } },
      settings: SETTINGS, trusted: [], now: NOW,
    };
    expect(evaluateScan(input)).toEqual(evaluateScan(input));
  });

  it('truncates the notification to 5 lines with an overflow count', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'].map((ch) => ch.repeat(32));
    const prev = ids.map((id) => ext({ id }));
    const curr = ids.map((id) => ext({ id, hostPermissions: ['<all_urls>'] }));
    const timestamps = Object.fromEntries(ids.map((id) => [id, { firstSeen: 0, lastVersionChange: 0 }]));
    const r = evaluateScan({ prev, curr, timestamps, settings: SETTINGS, trusted: [], now: NOW });
    expect(r.notification?.title).toBe('Ext-Ray: 6 changes need review');
    expect(r.notification?.message).toContain('…and 1 more');
  });

  it('uses singular grammar for a single change', () => {
    const r = evaluateScan({
      prev: [ext({ id: A })], curr: [ext({ id: A, hostPermissions: ['<all_urls>'] })],
      timestamps: { [A]: { firstSeen: 0, lastVersionChange: 0 } },
      settings: SETTINGS, trusted: [], now: NOW,
    });
    expect(r.notification?.title).toBe('Ext-Ray: 1 change needs review');
  });
});

describe('trusted', () => {
  const T = 't'.repeat(32);
  const N = 'n'.repeat(32);
  const notifyOn: Settings = { monitoringEnabled: true, scanIntervalMinutes: 5, notify: true };

  // info-level churn for a trusted extension is silenced and does NOT revoke trust
  it('suppresses info changes for a trusted extension without revoking trust', () => {
    const prev = [ext({ id: T, version: '1.0.0' })];
    const curr = [ext({ id: T, version: '1.0.1' })]; // version bump, no prior stability stamp → info
    const r = evaluateScan({ prev, curr, timestamps: {}, settings: notifyOn, trusted: [T], now: 0 });
    expect(r.classified).toHaveLength(0);
    expect(r.revokeTrust).toEqual([]);
    expect(r.notification).toBeNull();
  });
  // a MATERIAL change (host expansion) for a trusted extension alerts AND revokes trust
  it('alerts and revokes trust on a material change to a trusted extension', () => {
    const prev = [ext({ id: T, permissions: [], hostPermissions: [] })];
    const curr = [ext({ id: T, permissions: ['scripting'], hostPermissions: ['<all_urls>'] })];
    const r = evaluateScan({ prev, curr, timestamps: {}, settings: notifyOn, trusted: [T], now: 0 });
    expect(r.revokeTrust).toEqual([T]);
    expect(r.classified.some((c) => c.severity === 'high')).toBe(true);
    expect(r.notification).not.toBeNull();
  });
  // non-trusted extensions are unaffected
  it('does not revoke or suppress for non-trusted extensions', () => {
    const prev = [ext({ id: N, permissions: [] })];
    const curr = [ext({ id: N, permissions: ['cookies'] })];
    const r = evaluateScan({ prev, curr, timestamps: {}, settings: notifyOn, trusted: [], now: 0 });
    expect(r.revokeTrust).toEqual([]);
    expect(r.classified).toHaveLength(1);
  });
});

describe('isUntrustworthyScan', () => {
  const A = 'a'.repeat(32), B = 'b'.repeat(32);

  it('prev non-empty, curr empty → true (suspect transient race)', () => {
    expect(isUntrustworthyScan([ext({ id: A }), ext({ id: B })], [])).toBe(true);
  });

  it('prev non-empty, curr non-empty → false (normal scan)', () => {
    expect(isUntrustworthyScan([ext({ id: A })], [ext({ id: B })])).toBe(false);
  });

  it('prev empty, curr empty → false (genuine first run / no baseline)', () => {
    expect(isUntrustworthyScan([], [])).toBe(false);
  });

  it('prev empty, curr non-empty → false (normal first population)', () => {
    expect(isUntrustworthyScan([], [ext({ id: A })])).toBe(false);
  });
});
