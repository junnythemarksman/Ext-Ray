import { describe, it, expect } from 'vitest';
import type { ExtSnapshot, Change, ExtTimestamps } from '../types';
import { classifySeverity, STABILITY_WINDOW_DAYS, type ClassifyCtx } from './guardian';
import { evaluateScan } from './guardian';
import type { Settings } from '../types';

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

  it('normal install of a high/critical-tier extension is notable', () => {
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
      timestamps: {}, settings: SETTINGS, ignored: [], now: NOW,
    });
    expect(r.notification).toBeNull();
    expect(r.classified).toEqual([]);
    expect(r.timestamps[A]).toEqual({ firstSeen: NOW, lastVersionChange: NOW });
  });

  it('suppresses changes for ignored extensions', () => {
    const r = evaluateScan({
      prev: [ext({ id: A })], curr: [ext({ id: A, hostPermissions: ['<all_urls>'] })],
      timestamps: { [A]: { firstSeen: 0, lastVersionChange: 0 } },
      settings: SETTINGS, ignored: [A], now: NOW,
    });
    expect(r.classified).toEqual([]);
    expect(r.notification).toBeNull();
  });

  it('batches multiple noteworthy changes into one notification', () => {
    const r = evaluateScan({
      prev: [ext({ id: A }), ext({ id: B, updateUrl: 'http://old' })],
      curr: [ext({ id: A, hostPermissions: ['<all_urls>'] }), ext({ id: B, updateUrl: 'http://new' })],
      timestamps: { [A]: { firstSeen: 0, lastVersionChange: 0 }, [B]: { firstSeen: 0, lastVersionChange: 0 } },
      settings: SETTINGS, ignored: [], now: NOW,
    });
    expect(r.notification?.title).toBe('Ext-Ray: 2 changes need review');
  });

  it('stays silent when notifications are disabled, but still classifies + updates timestamps', () => {
    const r = evaluateScan({
      prev: [ext({ id: A })], curr: [ext({ id: A, hostPermissions: ['<all_urls>'] })],
      timestamps: { [A]: { firstSeen: 0, lastVersionChange: 0 } },
      settings: { ...SETTINGS, notify: false }, ignored: [], now: NOW,
    });
    expect(r.notification).toBeNull();
    expect(r.classified).toHaveLength(1);
  });

  it('updates timestamps: new id, version bump, carry-forward, and drops removed ids', () => {
    const r = evaluateScan({
      prev: [ext({ id: A, version: '1.0.0' }), ext({ id: B })],
      curr: [ext({ id: A, version: '2.0.0' }), ext({ id: C })],
      timestamps: { [A]: { firstSeen: 100, lastVersionChange: 100 }, [B]: { firstSeen: 200, lastVersionChange: 200 } },
      settings: SETTINGS, ignored: [], now: NOW,
    });
    expect(r.timestamps[A]).toEqual({ firstSeen: 100, lastVersionChange: NOW }); // bump
    expect(r.timestamps[C]).toEqual({ firstSeen: NOW, lastVersionChange: NOW }); // new
    expect(r.timestamps[B]).toBeUndefined();                                     // removed
  });

  it('is deterministic — same input, same result', () => {
    const input = {
      prev: [ext({ id: A })], curr: [ext({ id: A, hostPermissions: ['<all_urls>'] })],
      timestamps: { [A]: { firstSeen: 0, lastVersionChange: 0 } },
      settings: SETTINGS, ignored: [], now: NOW,
    };
    expect(evaluateScan(input)).toEqual(evaluateScan(input));
  });
});
