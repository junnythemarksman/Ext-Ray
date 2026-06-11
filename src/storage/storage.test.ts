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
  getTrusted,
  setTrusted,
  getSchemaVersion,
  migrate,
  setSnapshotAndTimestamps,
} from './storage';

// Minimal in-memory fake of chrome.storage.local (spec §9 mocks the chrome.* edge).
// Deliberately exposes ONLY `local` — no `sync` — so any accidental storage.sync use
// throws and fails the test, enforcing the "nothing leaves the device" constraint.
function installFakeChrome(): Record<string, unknown> {
  const store: Record<string, unknown> = {};
  const local = {
    async get(keys?: string | string[] | null) {
      if (keys === undefined || keys === null) return { ...store };
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

  it('migrate v1→v2 renames ignored→trusted and removes the old key', async () => {
    await chrome.storage.local.set({ schemaVersion: 1, ignored: ['a', 'b'] });
    await migrate();
    const all = await chrome.storage.local.get(null);
    expect(all.trusted).toEqual(['a', 'b']);
    expect('ignored' in all).toBe(false);
    expect(all.schemaVersion).toBe(2);
  });
  it('getTrusted/setTrusted round-trip', async () => {
    await setTrusted(['x']);
    expect(await getTrusted()).toEqual(['x']);
  });
});

describe('atomic snapshot+timestamps write (F-01)', () => {
  it('persists both keys in a single set() call (one WriteBatch — no torn-write window)', async () => {
    let setCalls = 0;
    const orig = chrome.storage.local.set.bind(chrome.storage.local);
    (chrome.storage.local as { set: (items: Record<string, unknown>) => Promise<void> }).set = async (items: Record<string, unknown>) => {
      setCalls += 1;
      return orig(items);
    };
    const snap = [ext()];
    const ts = { [snap[0]!.id]: { firstSeen: 1, lastVersionChange: 2 } };
    await setSnapshotAndTimestamps(snap, ts);
    (chrome.storage.local as { set: typeof orig }).set = orig;
    expect(setCalls).toBe(1);
    expect(await getSnapshot()).toEqual(snap);
    expect(await getTimestamps()).toEqual(ts);
  });
});
