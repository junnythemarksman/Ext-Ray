import { describe, it, expect, beforeEach } from 'vitest';
import { getExtensions, pickBestIcon } from './management';
import { getPermissionWarningsById, setEnabled, uninstall } from './management';

const SELF_ID = 's'.repeat(32);

function installFakeChrome(all: unknown[], selfId = SELF_ID): void {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { id: selfId },
    management: { getAll: async () => all },
  };
}

const info = (o: Record<string, unknown>) => ({
  id: 'a'.repeat(32), name: 'X', version: '1.0.0', enabled: true, type: 'extension',
  installType: 'normal', permissions: ['storage'], hostPermissions: [], mayDisable: true, ...o,
});

beforeEach(() => installFakeChrome([]));

describe('getExtensions', () => {
  it('excludes Ext-Ray itself', async () => {
    installFakeChrome([info({ id: SELF_ID }), info({ id: 'b'.repeat(32) })]);
    const ids = (await getExtensions()).map((e) => e.id);
    expect(ids).toEqual(['b'.repeat(32)]);
  });

  it('filters out non-extensions (themes/apps)', async () => {
    installFakeChrome([info({ id: 'a'.repeat(32), type: 'theme' }), info({ id: 'b'.repeat(32) })]);
    const ids = (await getExtensions()).map((e) => e.id);
    expect(ids).toEqual(['b'.repeat(32)]);
  });

  it('normalizes to the ExtSnapshot projection, defaulting permission arrays', async () => {
    installFakeChrome([info({ id: 'b'.repeat(32), permissions: undefined, hostPermissions: undefined })]);
    const [snap] = await getExtensions();
    expect(snap).toEqual({
      id: 'b'.repeat(32), name: 'X', version: '1.0.0', enabled: true, type: 'extension',
      installType: 'normal', permissions: [], hostPermissions: [], mayDisable: true, updateUrl: undefined,
    });
  });
});

describe('management actions', () => {
  it('getPermissionWarningsById returns the browser warnings for an id', async () => {
    const calls: string[] = [];
    (globalThis as unknown as { chrome: unknown }).chrome = {
      management: {
        getPermissionWarningsById: async (id: string) => { calls.push(id); return ['Read your data on all websites']; },
      },
    };
    expect(await getPermissionWarningsById('b'.repeat(32))).toEqual(['Read your data on all websites']);
    expect(calls).toEqual(['b'.repeat(32)]);
  });

  it('setEnabled calls through with the id and flag', async () => {
    const calls: Array<[string, boolean]> = [];
    (globalThis as unknown as { chrome: unknown }).chrome = {
      management: { setEnabled: async (id: string, on: boolean) => { calls.push([id, on]); } },
    };
    await setEnabled('b'.repeat(32), false);
    expect(calls).toEqual([['b'.repeat(32), false]]);
  });

  it('uninstall requests Chrome\'s native confirm dialog', async () => {
    const calls: Array<[string, unknown]> = [];
    (globalThis as unknown as { chrome: unknown }).chrome = {
      management: { uninstall: async (id: string, opts: unknown) => { calls.push([id, opts]); } },
    };
    await uninstall('b'.repeat(32));
    expect(calls).toEqual([['b'.repeat(32), { showConfirmDialog: true }]]);
  });
});

// Research caveats encoded: never icons[0] naively; guard undefined/empty; prefer the
// smallest icon ≥ target; else the largest available.
describe('pickBestIcon', () => {
  const icon = (size: number) => ({ size, url: `chrome://extension-icon/x/${size}` });

  it('returns undefined for undefined input', () => {
    expect(pickBestIcon(undefined, 48)).toBeUndefined();
  });
  it('returns undefined for an empty array', () => {
    expect(pickBestIcon([], 48)).toBeUndefined();
  });
  it('picks the exact size when present', () => {
    expect(pickBestIcon([icon(16), icon(48), icon(128)], 48)).toContain('/48');
  });
  it('picks the smallest size ≥ target (not the largest)', () => {
    expect(pickBestIcon([icon(16), icon(64), icon(128)], 48)).toContain('/64');
  });
  it('falls back to the largest when all are smaller than target', () => {
    expect(pickBestIcon([icon(16), icon(32)], 48)).toContain('/32');
  });
  it('does not assume input order (sorts internally)', () => {
    expect(pickBestIcon([icon(128), icon(16), icon(64)], 48)).toContain('/64');
  });
});
