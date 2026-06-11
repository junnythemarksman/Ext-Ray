// options/index.ts — controller glue (design spec §3.4). Loads settings + the
// installed-extension list + ignore list, renders the form, and auto-saves each
// change to storage. No unit tests (chrome.* + DOM glue) — exercised in Phase 8.

import { getExtensions } from '../src/management/management';
import { getSettings, setSettings, getIgnored, setIgnored } from '../src/storage/storage';
import { renderOptions } from './render';
import type { Settings, ExtSnapshot } from '../src/types';

const root = document.getElementById('app') as HTMLElement;

let settings: Settings;
let ignored: string[];

root.addEventListener('change', (e) => void onChange(e));
root.addEventListener('click', (e) => void onCopy(e));

// Copy-to-clipboard for the donation address. navigator.clipboard.writeText works in an
// extension page on a user gesture — no clipboardWrite permission needed (4-perm invariant holds).
async function onCopy(e: Event): Promise<void> {
  const btn = (e.target as HTMLElement).closest('button[data-copy]') as HTMLButtonElement | null;
  if (!btn) return;
  try {
    await navigator.clipboard.writeText(btn.dataset.copy ?? '');
    btn.textContent = 'Copied ✓';
    setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
  } catch {
    /* clipboard unavailable — the address is selectable text, user can copy manually */
  }
}

async function onChange(e: Event): Promise<void> {
  const target = e.target as HTMLInputElement & HTMLSelectElement;
  const setting = target.dataset.setting;
  const ignoreId = target.dataset.ignore;

  if (setting === 'monitoring') {
    settings = { ...settings, monitoringEnabled: target.checked };
    await setSettings(settings);
  } else if (setting === 'notify') {
    settings = { ...settings, notify: target.checked };
    await setSettings(settings);
  } else if (setting === 'cadence') {
    settings = { ...settings, scanIntervalMinutes: Number(target.value) };
    await setSettings(settings);
  } else if (ignoreId) {
    ignored = target.checked
      ? [...new Set([...ignored, ignoreId])]
      : ignored.filter((id) => id !== ignoreId);
    await setIgnored(ignored);
  }
}

async function load(): Promise<void> {
  settings = await getSettings();
  ignored = await getIgnored();
  const extensions: ExtSnapshot[] | null = await getExtensions().catch(() => null);
  renderOptions(settings, extensions, ignored, root);
}

void load();
