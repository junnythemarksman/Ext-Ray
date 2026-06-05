import { describe, it, expect } from 'vitest';
import { matchesSpec } from './debug';

describe('matchesSpec — the trace enable/disable decision', () => {
  it('is off by default: an empty spec matches nothing', () => {
    expect(matchesSpec('', 'calc.score')).toBe(false);
  });

  it('"*" enables every namespace', () => {
    expect(matchesSpec('*', 'calc.score')).toBe(true);
    expect(matchesSpec('*', 'sec.guardian')).toBe(true);
  });

  it('a family wildcard "calc.*" enables every calc.<sub> namespace', () => {
    expect(matchesSpec('calc.*', 'calc.score')).toBe(true);
    expect(matchesSpec('calc.*', 'calc.fleet')).toBe(true);
  });

  it('a family wildcard does not leak into other families', () => {
    expect(matchesSpec('calc.*', 'sec.guardian')).toBe(false);
    expect(matchesSpec('calc.*', 'perf.scan')).toBe(false);
  });

  it('an exact namespace enables only itself', () => {
    expect(matchesSpec('calc.score', 'calc.score')).toBe(true);
    expect(matchesSpec('calc.score', 'calc.fleet')).toBe(false);
  });

  it('honors comma-separated specs across families', () => {
    expect(matchesSpec('sec.*,perf.*', 'sec.guardian')).toBe(true);
    expect(matchesSpec('sec.*,perf.*', 'perf.scan')).toBe(true);
    expect(matchesSpec('sec.*,perf.*', 'calc.score')).toBe(false);
  });

  it('trims whitespace around comma-separated patterns', () => {
    expect(matchesSpec('  calc.* , sec.* ', 'sec.guardian')).toBe(true);
  });
});
