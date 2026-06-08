import { test, expect, swEval } from './fixtures';

test('a silent permission expansion produces exactly one notification', async ({ context }) => {
  // 1. Wait for the launch baseline scan to persist the full fleet (3 entries).
  await expect
    .poll(() => swEval<number>(context, async () =>
      ((await chrome.storage.local.get('snapshot')).snapshot ?? []).length))
    .toBe(3);

  // 2. Seed a PRIOR snapshot where "Fixture Critical" had no permissions yet, mirroring
  //    management.normalize() inline (no eval — MV3 CSP forbids unsafe-eval). The next scan then
  //    sees Critical gain scripting + <all_urls> (host-scope expansion = high severity, noteworthy).
  await swEval(context, async () => {
    const all = await chrome.management.getAll();
    const selfId = chrome.runtime.id;
    const fleet = all
      .filter((e) => e.type === 'extension' && e.id !== selfId)
      .map((e) => ({
        id: e.id, name: e.name, version: e.version, enabled: e.enabled, type: e.type,
        installType: e.installType, permissions: e.permissions ?? [],
        hostPermissions: e.hostPermissions ?? [], mayDisable: e.mayDisable, updateUrl: e.updateUrl,
      }));
    for (const f of fleet) if (f.name === 'Fixture Critical') { f.permissions = []; f.hostPermissions = []; }
    await chrome.storage.local.set({ snapshot: fleet });
  });

  // 3. Trigger a scan via an existing code path: disabling a fixture fires management.onDisabled
  //    → scheduleScan(). Disabling Fixture Low keeps the only diff = Critical's permission gain.
  const lowId = await swEval<string>(context, async () => {
    const all = await chrome.management.getAll();
    return all.find((e) => e.name === 'Fixture Low')!.id;
  });
  await swEval(context, async (id) => { await chrome.management.setEnabled(id, false); }, lowId);

  // 4. Snapshot-first assertion (always reliable): the scan ran and re-persisted Critical's perms.
  await expect
    .poll(() => swEval<string[]>(context, async () => {
      const snap = (await chrome.storage.local.get('snapshot')).snapshot ?? [];
      const crit = snap.find((e: any) => e.name === 'Fixture Critical');
      return crit ? crit.permissions : [];
    }))
    .toContain('scripting');

  // 5. Exactly one notification was created (content is unit-tested in guardian.test.ts).
  //    If getAll() proves empty under new-headless, re-run this spec with HEADED=1 (spec §5.3, §7).
  await expect
    .poll(() => swEval<number>(context, async () =>
      Object.keys(await chrome.notifications.getAll()).length))
    .toBe(1);
});
