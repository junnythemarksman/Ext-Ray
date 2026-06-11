// management/ — the chrome.management edge (thin glue, design spec §3.1).
// The only chrome.management call this phase. Phase 6 extends it with
// getPermissionWarningsById for the popup.

import type { ExtSnapshot } from '../types';

/** Smallest declared icon ≥ target px, else the largest available (HiDPI-friendly).
 *  Never icons[0] (manifest order is usually smallest-first); never hand-built URLs. */
export function pickBestIcon(
  icons: Array<{ size: number; url: string }> | undefined,
  target: number,
): string | undefined {
  if (!icons || icons.length === 0) return undefined;
  const sorted = [...icons].sort((a, b) => a.size - b.size);
  return (sorted.find((i) => i.size >= target) ?? sorted[sorted.length - 1])!.url;
}

function normalize(e: chrome.management.ExtensionInfo): ExtSnapshot {
  return {
    id: e.id,
    name: e.name,
    version: e.version,
    enabled: e.enabled,
    type: e.type,
    installType: e.installType,
    permissions: e.permissions ?? [],
    hostPermissions: e.hostPermissions ?? [],
    mayDisable: e.mayDisable,
    updateUrl: e.updateUrl,
    iconUrl: pickBestIcon(e.icons, 48),
  };
}

/** Installed extensions (excluding themes/apps and Ext-Ray itself), normalized. */
export async function getExtensions(): Promise<ExtSnapshot[]> {
  const all = await chrome.management.getAll();
  const selfId = chrome.runtime.id;
  return all.filter((e) => e.type === 'extension' && e.id !== selfId).map(normalize);
}

/** The browser's own human-readable permission warnings for an installed extension (C1). */
export const getPermissionWarningsById = (id: string): Promise<string[]> =>
  chrome.management.getPermissionWarningsById(id);

/** Enable or disable an installed extension. */
export const setEnabled = (id: string, enabled: boolean): Promise<void> =>
  chrome.management.setEnabled(id, enabled);

/** Uninstall via Chrome's native confirmation dialog (rejects if the user cancels). */
export const uninstall = (id: string): Promise<void> =>
  chrome.management.uninstall(id, { showConfirmDialog: true });
