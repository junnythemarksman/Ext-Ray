// storage/ — typed chrome.storage.local persistence (design spec §5.3).
//
// Design choices, grounded in current Chrome guidance (2025):
//   • LOCAL ONLY. storage.sync would replicate to the user's Google account — data
//     leaving the device, which breaks Ext-Ray's core "nothing leaves the device"
//     guarantee. local also has the larger quota (10 MB vs sync's ~100 KB).
//   • NOT a secret vault. chrome.storage.local is plaintext in the profile directory
//     (not encrypted). Ext-Ray persists only non-sensitive extension METADATA here —
//     all of which is already readable via chrome.management. Never store secrets/PII.
//   • STATELESS + async. The MV3 service worker is ephemeral, so storage — not an
//     in-memory global — is the source of truth. Every accessor reads/writes live.
//   • No `unlimitedStorage` permission: the stored data is kilobytes, far under quota,
//     and the 4-permission footprint is the product's trust signal.
//   • No setAccessLevel: Ext-Ray has no content scripts, so local's default
//     content-script exposure is moot.
// Refs: developer.chrome.com/docs/extensions/reference/api/storage,
//       developer.chrome.com/docs/extensions/develop/migrate/to-service-workers (2025).

import type { ExtSnapshot, Settings, ExtTimestamps } from '../types';
import { trace } from '../debug';

const tStore = trace('perf.storage');

/** Bump when the persisted shape changes, and add a step in migrate(). */
export const SCHEMA_VERSION = 1;

const KEYS = {
  schemaVersion: 'schemaVersion',
  snapshot: 'snapshot',
  settings: 'settings',
  timestamps: 'timestamps',
  ignored: 'ignored',
} as const;

export const DEFAULT_SETTINGS: Settings = {
  monitoringEnabled: true,
  scanIntervalMinutes: 5,
  notify: true,
};

async function read<T>(key: string, fallback: T): Promise<T> {
  const got = await chrome.storage.local.get(key);
  return (got[key] as T | undefined) ?? fallback;
}

async function write(key: string, value: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
  if (tStore.enabled) tStore('write', { key, items: 1 });
}

export const getSnapshot = (): Promise<ExtSnapshot[]> => read(KEYS.snapshot, []);
export const setSnapshot = (snapshot: ExtSnapshot[]): Promise<void> => write(KEYS.snapshot, snapshot);

export async function getSettings(): Promise<Settings> {
  // Merge stored over defaults so fields added in a later version still resolve.
  return { ...DEFAULT_SETTINGS, ...(await read<Partial<Settings>>(KEYS.settings, {})) };
}
export const setSettings = (settings: Settings): Promise<void> => write(KEYS.settings, settings);

export const getTimestamps = (): Promise<Record<string, ExtTimestamps>> =>
  read(KEYS.timestamps, {} as Record<string, ExtTimestamps>);
export const setTimestamps = (timestamps: Record<string, ExtTimestamps>): Promise<void> =>
  write(KEYS.timestamps, timestamps);

export const getIgnored = (): Promise<string[]> => read(KEYS.ignored, [] as string[]);
export const setIgnored = (ids: string[]): Promise<void> => write(KEYS.ignored, ids);

/** 0 = uninitialized (no prior install); otherwise the stamped schema version. */
export const getSchemaVersion = (): Promise<number> => read(KEYS.schemaVersion, 0);

/**
 * Bring stored data up to SCHEMA_VERSION. Idempotent — safe to call on every
 * service-worker startup. v0→v1 is a no-op stamp (the initial shape); future
 * shape changes add a step here.
 */
export async function migrate(): Promise<void> {
  const from = await getSchemaVersion();
  if (from >= SCHEMA_VERSION) return;
  // (future: if (from < N) { ...transform... })
  await write(KEYS.schemaVersion, SCHEMA_VERSION);
}
