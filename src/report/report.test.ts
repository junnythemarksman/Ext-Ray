import { describe, it, expect } from 'vitest';
import type { ExtSnapshot } from '../types';
import { buildReport } from './report';

function ext(o: Partial<ExtSnapshot> = {}): ExtSnapshot {
  return {
    id: 'a'.repeat(32), name: 'X', version: '1.0.0', enabled: true, type: 'extension',
    installType: 'normal', permissions: [], hostPermissions: [], mayDisable: true, ...o,
  };
}

describe('buildReport', () => {
  it('grades an empty fleet as A with empty lists', () => {
    const r = buildReport([]);
    expect(r.grade.grade).toBe('A');
    expect(r.risky).toEqual([]);
    expect(r.low).toEqual([]);
    expect(r.counts).toEqual({ total: 0, risky: 0, low: 0, trusted: 0 });
  });

  it('partitions risky (tier ≥ medium) from low, worst-first', () => {
    const crit = ext({ id: 'c'.repeat(32), name: 'Crit', hostPermissions: ['<all_urls>'] }); // critical
    const med = ext({ id: 'm'.repeat(32), name: 'Med', permissions: ['tabs'] });              // medium
    const low = ext({ id: 'l'.repeat(32), name: 'Low' });                                     // low
    const r = buildReport([low, med, crit]);
    expect(r.risky.map((c) => c.id)).toEqual(['c'.repeat(32), 'm'.repeat(32)]); // score desc
    expect(r.low.map((x) => x.id)).toEqual(['l'.repeat(32)]);
    expect(r.counts).toEqual({ total: 3, risky: 2, low: 1, trusted: 0 });
  });

  it('passes plain-English reasons through to risky cards', () => {
    const r = buildReport([ext({ hostPermissions: ['<all_urls>'] })]);
    expect(r.risky[0]!.reasons.length).toBeGreaterThan(0);
    expect(r.risky[0]!.tier).toBe('critical');
  });

  it('carries enabled + canDisable (from mayDisable) onto cards and rows', () => {
    const r = buildReport([
      ext({ id: 'c'.repeat(32), hostPermissions: ['<all_urls>'], enabled: false, mayDisable: false }),
      ext({ id: 'l'.repeat(32), enabled: true, mayDisable: true }),
    ]);
    expect(r.risky[0]!.enabled).toBe(false);
    expect(r.risky[0]!.canDisable).toBe(false);
    expect(r.low[0]!.enabled).toBe(true);
    expect(r.low[0]!.canDisable).toBe(true);
  });

  it('breaks score ties by name for determinism', () => {
    const a = ext({ id: 'a'.repeat(32), name: 'Zeta', permissions: ['tabs'] });
    const b = ext({ id: 'b'.repeat(32), name: 'Alpha', permissions: ['tabs'] });
    const r = buildReport([a, b]);
    expect(r.risky.map((c) => c.name)).toEqual(['Alpha', 'Zeta']);
    expect(buildReport([a, b])).toEqual(buildReport([b, a])); // order-independent
  });

  it('orders low-risk rows worst-first too', () => {
    const quiet = ext({ id: 'a'.repeat(32), name: 'Quiet', permissions: ['storage'] });   // ~0.1 → low
    const tabby = ext({ id: 'b'.repeat(32), name: 'Tabby', permissions: ['activeTab'] });  // ~0.2 → low
    const r = buildReport([quiet, tabby]);
    expect(r.low.map((x) => x.id)).toEqual(['b'.repeat(32), 'a'.repeat(32)]); // 0.2 before 0.1
  });

  it('plumbs iconUrl through to risky cards and low rows', () => {
    const withIcon = (id: string, perms: string[], iconUrl?: string): ExtSnapshot => ({
      id, name: id, version: '1.0.0', enabled: true, type: 'extension',
      installType: 'normal', permissions: perms, hostPermissions: [],
      mayDisable: true, iconUrl,
    });
    const view = buildReport([
      withIcon('risky', ['debugger'], 'chrome://extension-icon/risky/48'),
      withIcon('safe', ['storage'], 'chrome://extension-icon/safe/48'),
      withIcon('noicon', ['storage']),
    ]);
    expect(view.risky[0]!.iconUrl).toBe('chrome://extension-icon/risky/48');
    const safeRow = view.low.find((r) => r.id === 'safe')!;
    const noIconRow = view.low.find((r) => r.id === 'noicon')!;
    expect(safeRow.iconUrl).toBe('chrome://extension-icon/safe/48');
    expect(noIconRow.iconUrl).toBeUndefined();
  });
});

describe('buildReport trusted partitioning', () => {
  function mk(id: string, perms: string[]): ExtSnapshot {
    return {
      id, name: id, version: '1.0.0', enabled: true, type: 'extension',
      installType: 'normal', permissions: perms, hostPermissions: [],
      mayDisable: true,
    };
  }

  it('excludes trusted extensions from risky/low and from the grade', () => {
    const crit = mk('crit', ['debugger']);          // would be critical
    const lowE = mk('low', ['storage']);
    const view = buildReport([crit, lowE], ['crit']);
    expect(view.trusted.map((c) => c.id)).toEqual(['crit']);
    expect(view.risky.find((c) => c.id === 'crit')).toBeUndefined();
    expect(view.counts).toEqual({ total: 2, risky: 0, low: 1, trusted: 1 });
    // grade computed over the non-trusted (only the low) → not F
    expect(view.grade.grade).not.toBe('F');
  });
  it('all-trusted fleet grades A with the trusted count', () => {
    const view = buildReport([mk('a', ['debugger']), mk('b', ['scripting'])], ['a', 'b']);
    expect(view.grade.grade).toBe('A');
    expect(view.counts.trusted).toBe(2);
    expect(view.risky).toHaveLength(0);
  });
  it('keeps the risky+low+trusted === total invariant', () => {
    const view = buildReport([mk('a', ['debugger']), mk('b', ['cookies']), mk('c', ['storage'])], ['b']);
    expect(view.risky.length + view.low.length + view.trusted.length).toBe(3);
  });
});

describe('informational signals (signal pack)', () => {
  it('threads signals onto risky cards, low rows, and trusted cards', () => {
    const crit = ext({ id: 'c'.repeat(32), hostPermissions: ['<all_urls>'], updateUrl: 'https://u.example.com/c.xml' });
    const low = ext({ id: 'l'.repeat(32), updateUrl: 'https://u.example.com/l.xml' });
    const tr = ext({ id: 't'.repeat(32), enabled: false, disabledReason: 'permissions_increase' });
    const r = buildReport([crit, low, tr], ['t'.repeat(32)]);
    expect(r.risky[0]!.signals.some((s) => s.includes('outside the official extension store'))).toBe(true);
    expect(r.risky[0]!.signals.some((s) => s.includes('same server (u.example.com)'))).toBe(true);
    expect(r.low[0]!.signals.some((s) => s.includes('outside the official extension store'))).toBe(true);
    expect(r.low[0]!.signals.some((s) => s.includes('same server (u.example.com)'))).toBe(true);
    expect(r.trusted[0]!.signals).toEqual(['Chrome disabled this extension: an update requested more permissions']);
  });

  it('signals never affect the grade', () => {
    const plain = ext({ id: 'a'.repeat(32) });
    // b has real permissions so the fleet grade is non-trivial
    const withSignal = ext({ id: 'b'.repeat(32), permissions: ['tabs'], updateUrl: 'https://u.example.com/x.xml' });
    const withoutSignal = ext({ id: 'b'.repeat(32), permissions: ['tabs'] });
    expect(buildReport([plain, withSignal]).grade).toEqual(buildReport([plain, withoutSignal]).grade);
  });

  it('defaults to an empty signals array', () => {
    const r = buildReport([ext()]);
    expect(r.low[0]!.signals).toEqual([]);
  });
});
