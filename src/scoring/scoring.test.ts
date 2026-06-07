import { describe, it, expect } from 'vitest';
import type { ExtSnapshot, Verdict } from '../types';
import { scoreExtension, gradeFleet } from './scoring';

function ext(overrides: Partial<ExtSnapshot> = {}): ExtSnapshot {
  return {
    id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    name: 'Test Extension',
    version: '1.0.0',
    enabled: true,
    type: 'extension',
    installType: 'normal',
    permissions: [],
    hostPermissions: [],
    mayDisable: true,
    ...overrides,
  };
}

describe('scoreExtension', () => {
  it('grades a zero-permission extension as low risk', () => {
    const v = scoreExtension(ext());
    expect(v.tier).toBe('low');
  });

  it('grades "<all_urls>" host access as critical', () => {
    const v = scoreExtension(ext({ hostPermissions: ['<all_urls>'] }));
    expect(v.tier).toBe('critical');
  });

  it('grades the "*://*/*" match pattern as critical', () => {
    const v = scoreExtension(ext({ hostPermissions: ['*://*/*'] }));
    expect(v.tier).toBe('critical');
  });

  it('grades the "userScripts" remote-code permission as critical', () => {
    // Chrome 138 gates userScripts behind a dedicated per-extension toggle — its
    // declared presence is a uniquely high-risk, browser-endorsed signal (research N2).
    const v = scoreExtension(ext({ permissions: ['userScripts'] }));
    expect(v.tier).toBe('critical');
  });

  it('bumps risk for a sideloaded extension over the same one installed normally', () => {
    const base = { permissions: ['storage'], hostPermissions: ['https://example.com/*'] };
    const normal = scoreExtension(ext({ ...base, installType: 'normal' }));
    const sideloaded = scoreExtension(ext({ ...base, installType: 'sideload' }));
    expect(sideloaded.score).toBeGreaterThan(normal.score);
  });

  it('treats a disabled extension as lower risk than the same one enabled', () => {
    const risky = { permissions: ['cookies', 'tabs'] };
    const enabled = scoreExtension(ext({ ...risky, enabled: true }));
    const disabled = scoreExtension(ext({ ...risky, enabled: false }));
    expect(disabled.score).toBeLessThan(enabled.score);
  });

  it('always returns a score within [0, 1]', () => {
    const samples = [
      ext(),
      ext({ hostPermissions: ['<all_urls>'], permissions: ['debugger', 'proxy', 'cookies'] }),
      ext({ permissions: ['storage'], installType: 'development' }),
      ext({ hostPermissions: ['https://a.example/*', '*://*/*'] }),
    ];
    for (const s of samples) {
      const v = scoreExtension(s);
      expect(v.score).toBeGreaterThanOrEqual(0);
      expect(v.score).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic — same input, same verdict', () => {
    const input = ext({ hostPermissions: ['<all_urls>'], permissions: ['cookies'] });
    expect(scoreExtension(input)).toEqual(scoreExtension(input));
  });

  it('explains a risky verdict with at least one plain-English reason', () => {
    const v = scoreExtension(ext({ hostPermissions: ['<all_urls>'] }));
    expect(v.reasons.length).toBeGreaterThan(0);
    expect(v.reasons.every((r) => r.length > 0)).toBe(true);
  });
});

describe('gradeFleet', () => {
  const verdict = (score: number): Verdict => ({ tier: 'low', score, reasons: [] });

  it('grades an empty fleet as A with zero risk', () => {
    expect(gradeFleet([])).toEqual({ grade: 'A', score: 0 });
  });

  it('grades an all-low fleet as A', () => {
    expect(gradeFleet([verdict(0.1), verdict(0.05), verdict(0.12)]).grade).toBe('A');
  });

  it('does not let many safe extensions hide a single critical one', () => {
    const fleet = [verdict(0.1), verdict(0.05), verdict(0.1), verdict(0.98)];
    expect(gradeFleet(fleet).grade).not.toBe('A');
  });

  it('keeps the aggregate at least as high as the worst single score', () => {
    const fleet = [verdict(0.1), verdict(0.05), verdict(0.7)];
    const worst = Math.max(...fleet.map((v) => v.score));
    expect(gradeFleet(fleet).score).toBeGreaterThanOrEqual(worst);
  });

  it('always returns a fleet score within [0, 1]', () => {
    expect(gradeFleet([verdict(1), verdict(1), verdict(1)]).score).toBeLessThanOrEqual(1);
  });
});
