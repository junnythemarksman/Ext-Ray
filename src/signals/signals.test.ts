import { describe, it, expect } from 'vitest';
import type { ExtSnapshot } from '../types';
import { fleetSignals } from './signals';

function ext(o: Partial<ExtSnapshot> = {}): ExtSnapshot {
  return {
    id: 'a'.repeat(32), name: 'X', version: '1.0.0', enabled: true, type: 'extension',
    installType: 'normal', permissions: [], hostPermissions: [], mayDisable: true, ...o,
  };
}
const CWS = 'https://clients2.google.com/service/update2/crx';
const EDGE = 'https://edge.microsoft.com/extensionwebstorebase/v1/crx';

describe('fleetSignals', () => {
  it('returns an empty list for a plain store-updated extension', () => {
    expect(fleetSignals([ext({ updateUrl: CWS })]).get('a'.repeat(32))).toEqual([]);
  });

  it('never flags an absent updateUrl (the normal CWS case)', () => {
    expect(fleetSignals([ext()]).get('a'.repeat(32))).toEqual([]);
  });

  it('does not flag the Edge Add-ons store host', () => {
    expect(fleetSignals([ext({ updateUrl: EDGE })]).get('a'.repeat(32))).toEqual([]);
  });

  it('notes a disabled-for-permissions state', () => {
    const s = fleetSignals([ext({ enabled: false, disabledReason: 'permissions_increase' })]);
    expect(s.get('a'.repeat(32))).toEqual([
      'Chrome disabled this extension: an update requested more permissions',
    ]);
  });

  it('says nothing about a disabled extension with reason "unknown"', () => {
    expect(fleetSignals([ext({ enabled: false, disabledReason: 'unknown' })]).get('a'.repeat(32))).toEqual([]);
  });

  it('notes a non-store update source', () => {
    const s = fleetSignals([ext({ updateUrl: 'https://updates.example.com/ext.xml' })]);
    expect(s.get('a'.repeat(32))).toEqual(['Updates from outside the official extension store']);
  });

  it('adds enterprise context for admin installs', () => {
    const s = fleetSignals([ext({ installType: 'admin', updateUrl: 'https://corp.example.com/u.xml' })]);
    expect(s.get('a'.repeat(32))).toEqual([
      'Updates from outside the official extension store (enterprise-managed installs commonly self-host)',
    ]);
  });

  it('safe-fails a malformed updateUrl as non-store (over-notes, never under-notes)', () => {
    const s = fleetSignals([ext({ updateUrl: 'not a url' })]);
    expect(s.get('a'.repeat(32))).toEqual(['Updates from outside the official extension store']);
  });

  it('flags a shared non-store host on every member of the cluster', () => {
    const a = ext({ id: 'a'.repeat(32), updateUrl: 'https://u.example.com/a.xml' });
    const b = ext({ id: 'b'.repeat(32), updateUrl: 'https://u.example.com/b.xml' });
    const s = fleetSignals([a, b]);
    const shared = 'Updates from the same server (u.example.com) as 1 other installed extension — could be one developer or one operator';
    expect(s.get('a'.repeat(32))).toContain(shared);
    expect(s.get('b'.repeat(32))).toContain(shared);
  });

  it('counts peers for a 3-extension cluster (n = 2 each, plural)', () => {
    const ids = ['a', 'b', 'c'].map((ch) => ch.repeat(32));
    const fleet = ids.map((id) => ext({ id, updateUrl: 'https://u.example.com/x.xml' }));
    const s = fleetSignals(fleet);
    for (const id of ids) {
      expect(s.get(id)!.some((t) => t.includes('as 2 other installed extensions'))).toBe(true);
    }
  });

  it('never clusters extensions sharing a STORE host', () => {
    const a = ext({ id: 'a'.repeat(32), updateUrl: CWS });
    const b = ext({ id: 'b'.repeat(32), updateUrl: CWS });
    const s = fleetSignals([a, b]);
    expect(s.get('a'.repeat(32))).toEqual([]);
    expect(s.get('b'.repeat(32))).toEqual([]);
  });

  it('is deterministic and covers every input id', () => {
    const fleet = [ext({ id: 'a'.repeat(32) }), ext({ id: 'b'.repeat(32), updateUrl: CWS })];
    expect(fleetSignals(fleet)).toEqual(fleetSignals(fleet));
    expect([...fleetSignals(fleet).keys()].sort()).toEqual([fleet[0]!.id, fleet[1]!.id].sort());
  });
});
