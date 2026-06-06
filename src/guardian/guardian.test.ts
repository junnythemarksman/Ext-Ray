import { describe, it, expect } from 'vitest';
import type { ExtSnapshot, Change, ExtTimestamps } from '../types';
import { classifySeverity, STABILITY_WINDOW_DAYS, type ClassifyCtx } from './guardian';

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
});
