import { describe, it, expect } from 'vitest';
import type { ExtSnapshot } from '../types';
import { diff } from './snapshot';

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

describe('diff', () => {
  it('reports no changes between identical snapshots', () => {
    const snap = [ext()];
    expect(diff(snap, snap)).toEqual([]);
  });

  it('first run (no previous snapshot) reports installs only — never spurious "changed" alerts', () => {
    const curr = [ext({ id: 'a'.repeat(32), version: '2.0.0', permissions: ['cookies'] })];
    const changes = diff([], curr);
    expect(changes).toEqual([{ kind: 'installed', id: 'a'.repeat(32), name: 'Test Extension' }]);
  });

  it('detects a newly installed extension', () => {
    const prev = [ext({ id: 'a'.repeat(32) })];
    const curr = [ext({ id: 'a'.repeat(32) }), ext({ id: 'b'.repeat(32), name: 'New One' })];
    expect(diff(prev, curr)).toContainEqual({ kind: 'installed', id: 'b'.repeat(32), name: 'New One' });
  });

  it('detects a removed extension', () => {
    const prev = [ext({ id: 'a'.repeat(32), name: 'Gone' })];
    expect(diff(prev, [])).toEqual([{ kind: 'removed', id: 'a'.repeat(32), name: 'Gone' }]);
  });

  it('detects an added API permission', () => {
    const prev = [ext({ permissions: ['storage'] })];
    const curr = [ext({ permissions: ['storage', 'cookies'] })];
    expect(diff(prev, curr)).toContainEqual(
      expect.objectContaining({ kind: 'permissions-added', permissions: ['cookies'] }),
    );
  });

  it('treats host-scope expansion as a permission addition (the #1 silent-update signal)', () => {
    const prev = [ext({ hostPermissions: ['https://example.com/*'] })];
    const curr = [ext({ hostPermissions: ['https://example.com/*', '<all_urls>'] })];
    expect(diff(prev, curr)).toContainEqual(
      expect.objectContaining({ kind: 'permissions-added', permissions: ['<all_urls>'] }),
    );
  });

  it('detects a removed permission', () => {
    const prev = [ext({ permissions: ['storage', 'cookies'] })];
    const curr = [ext({ permissions: ['storage'] })];
    expect(diff(prev, curr)).toContainEqual(
      expect.objectContaining({ kind: 'permissions-removed', permissions: ['cookies'] }),
    );
  });

  it('detects a version-only bump with no other change', () => {
    const prev = [ext({ version: '1.0.0' })];
    const curr = [ext({ version: '1.0.1' })];
    expect(diff(prev, curr)).toEqual([
      { kind: 'version-changed', id: 'a'.repeat(32), name: 'Test Extension', from: '1.0.0', to: '1.0.1' },
    ]);
  });

  it('detects an updateUrl (publisher) change', () => {
    const prev = [ext({ updateUrl: 'https://clients2.google.com/service/update2/crx' })];
    const curr = [ext({ updateUrl: 'https://evil.example/update.xml' })];
    expect(diff(prev, curr)).toContainEqual(
      expect.objectContaining({
        kind: 'publisher-changed',
        from: 'https://clients2.google.com/service/update2/crx',
        to: 'https://evil.example/update.xml',
      }),
    );
  });

  it('reports multiple changes for one extension that bumped version and gained a permission', () => {
    const prev = [ext({ version: '1.0.0', permissions: ['storage'] })];
    const curr = [ext({ version: '2.0.0', permissions: ['storage', 'cookies'] })];
    const kinds = diff(prev, curr).map((c) => c.kind).sort();
    expect(kinds).toEqual(['permissions-added', 'version-changed']);
  });

  it('is deterministic — same inputs, same output', () => {
    const prev = [ext({ id: 'a'.repeat(32), permissions: ['storage'] })];
    const curr = [ext({ id: 'a'.repeat(32), permissions: ['cookies'] }), ext({ id: 'b'.repeat(32) })];
    expect(diff(prev, curr)).toEqual(diff(prev, curr));
  });

  // Signal pack: identity churn (name) is a tracked Change — info severity, paper-backed.
  it('detects a renamed extension (from → to)', () => {
    const prev = [ext({ name: 'Honest Tool' })];
    const curr = [ext({ name: 'Shiny Rebrand' })];
    expect(diff(prev, curr)).toEqual([
      { kind: 'name-changed', id: 'a'.repeat(32), from: 'Honest Tool', to: 'Shiny Rebrand' },
    ]);
  });

  it('does not report name-changed on first sight (install only)', () => {
    expect(diff([], [ext({ name: 'Brand New' })])).toEqual([
      { kind: 'installed', id: 'a'.repeat(32), name: 'Brand New' },
    ]);
  });
});
