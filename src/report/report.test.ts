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
    expect(r.counts).toEqual({ total: 0, risky: 0, low: 0 });
  });

  it('partitions risky (tier ≥ medium) from low, worst-first', () => {
    const crit = ext({ id: 'c'.repeat(32), name: 'Crit', hostPermissions: ['<all_urls>'] }); // critical
    const med = ext({ id: 'm'.repeat(32), name: 'Med', permissions: ['tabs'] });              // medium
    const low = ext({ id: 'l'.repeat(32), name: 'Low' });                                     // low
    const r = buildReport([low, med, crit]);
    expect(r.risky.map((c) => c.id)).toEqual(['c'.repeat(32), 'm'.repeat(32)]); // score desc
    expect(r.low.map((x) => x.id)).toEqual(['l'.repeat(32)]);
    expect(r.counts).toEqual({ total: 3, risky: 2, low: 1 });
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
});
