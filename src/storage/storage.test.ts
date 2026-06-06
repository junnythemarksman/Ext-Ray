import { describe, it, expect, beforeEach } from 'vitest';
import type { ExtSnapshot, ExtTimestamps } from '../types';
import {
  SCHEMA_VERSION,
  DEFAULT_SETTINGS,
  getSnapshot,
  setSnapshot,
  getSettings,
  setSettings,
  getTimestamps,
  setTimestamps,
  getIgnored,
  setIgnored,
  getSchemaVersion,
  migrate,
} from './storage';

// Minimal in-memory fake of chrome.storage.local (spec §9 mocks the chrome.* edge).
// Deliberately exposes ONLY `local` — no `sync` — so any accidental storage.sync use
// throws and fails the test, enforcing the "nothing leaves the device" constraint.
function installFakeChrome(): Record<string, unknown> {
  const store: Record<string, unknown> = {};
  const local = {
    async get(keys?: string | string[]) {
      if (keys === undefined) return { ...store };
      const list = Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const k of list) if (k in store) out[k] = store[k];
      return out;
    },
    async set(items: Record<string, unknown>) {
      Object.assign(store, items);
    },
    async remove(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k];
    },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = { storage: { local } };
  return store;
}

function ext(overrides: Partial<ExtSnapshot> = {}): ExtSnapshot {
  return {
    id: 'a'.repeat(32),
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

beforeEach(() => {
  installFakeChrome();
});

describe('snapshot persistence', () => {
  it('defaults to an empty array when nothing is stored', async () => {
    expect(await getSnapshot()).toEqual([]);
  });

  it('round-trips a stored snapshot', async () => {
    const snap = [ext({ permissions: ['cookies'] })];
    await setSnapshot(snap);
    expect(await getSnapshot()).toEqual(snap);
  });
});

describe('settings persistence', () => {
  it('returns the defaults when nothing is stored', async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips stored settings', async () => {
    const settings = { monitoringEnabled: false, scanIntervalMinutes: 15, notify: false };
    await setSettings(settings);
    expect(await getSettings()).toEqual(settings);
  });

  it('merges defaults over a partial stored object (forward-compatible reads)', async () => {
    // Simulate an older stored shape missing a field added later.
    await setSettings({ monitoringEnabled: false } as never);
    const settings = await getSettings();
    expect(settings.monitoringEnabled).toBe(false);
    expect(settings.scanIntervalMinutes).toBe(DEFAULT_SETTINGS.scanIntervalMinutes);
    expect(settings.notify).toBe(DEFAULT_SETTINGS.notify);
  });
});

describe('timestamps persistence', () => {
  it('defaults to an empty map', async () => {
    expect(await getTimestamps()).toEqual({});
  });

  it('round-trips the timestamps map', async () => {
    const ts: Record<string, ExtTimestamps> = {
      ['a'.repeat(32)]: { firstSeen: 1000, lastVersionChange: 2000 },
    };
    await setTimestamps(ts);
    expect(await getTimestamps()).toEqual(ts);
  });
});

describe('ignore list persistence', () => {
  it('defaults to an empty list', async () => {
    expect(await getIgnored()).toEqual([]);
  });

  it('round-trips the ignore list', async () => {
    await setIgnored(['a'.repeat(32), 'b'.repeat(32)]);
    expect(await getIgnored()).toEqual(['a'.repeat(32), 'b'.repeat(32)]);
  });
});

describe('schema versioning', () => {
  it('reports schema version 0 (uninitialized) before migration', async () => {
    expect(await getSchemaVersion()).toBe(0);
  });

  it('migrate() stamps the current schema version', async () => {
    await migrate();
    expect(await getSchemaVersion()).toBe(SCHEMA_VERSION);
  });

  it('migrate() is idempotent', async () => {
    await migrate();
    await migrate();
    expect(await getSchemaVersion()).toBe(SCHEMA_VERSION);
  });
});
