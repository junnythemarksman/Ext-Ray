// options/render.ts — dumb data→DOM map (design spec §3.3). No logic beyond mapping;
// built with createElement so extension names are never interpreted as HTML. Phase 8 tested.

import type { Settings, ExtSnapshot } from '../src/types';

const CADENCE_PRESETS = [1, 5, 15, 30, 60];

// Bech32 checksum verified before embedding (segwit v0 P2WPKH) — do not retype by hand.
const BTC_ADDRESS = 'bc1qux0rkwceymkq6nzya8wzzamj0amus6l35pzeq2';

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function checkbox(checked: boolean): HTMLInputElement {
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = checked;
  return box;
}

function settingRow(setting: 'monitoring' | 'notify', label: string, checked: boolean): HTMLElement {
  const row = el('label', 'row');
  const box = checkbox(checked);
  box.dataset.setting = setting;
  row.append(box, el('span', 'label', label));
  return row;
}

function cadenceRow(current: number): HTMLElement {
  const row = el('label', 'row');
  row.append(el('span', 'label', 'Re-scan every'));
  const select = document.createElement('select');
  select.className = 'cadence';
  select.dataset.setting = 'cadence';
  for (const min of CADENCE_PRESETS) {
    const opt = document.createElement('option');
    opt.value = String(min);
    opt.textContent = min === 1 ? '1 minute' : `${min} minutes`;
    if (min === current) opt.selected = true;
    select.append(opt);
  }
  row.append(select);
  return row;
}

function trustRow(ext: ExtSnapshot, trusted: boolean): HTMLElement {
  const row = el('label', 'row');
  const box = checkbox(trusted);
  box.dataset.trust = ext.id;
  row.append(box, el('span', 'label', ext.name));
  return row;
}

export function renderOptions(
  settings: Settings,
  extensions: ExtSnapshot[] | null, // null = couldn't read the extension list
  trusted: string[],
  root: HTMLElement,
): void {
  const trustedSet = new Set(trusted);
  root.className = 'options';
  root.replaceChildren();

  root.append(el('h1', 'title', 'Ext-Ray — Settings'));
  root.append(settingRow('monitoring', 'Watch for changes in the background', settings.monitoringEnabled));
  root.append(cadenceRow(settings.scanIntervalMinutes));
  root.append(settingRow('notify', 'Notify me when something changes', settings.notify));

  const section = el('section', 'ignore-section');
  section.append(el('h2', 'section-title', 'Trusted (alerts only if they change)'));
  if (extensions === null) {
    section.append(el('p', 'note', 'Couldn’t read your extensions.'));
  } else if (extensions.length === 0) {
    section.append(el('p', 'note', 'No other extensions installed.'));
  } else {
    for (const ext of extensions) section.append(trustRow(ext, trustedSet.has(ext.id)));
  }
  root.append(section);

  const support = el('section', 'support-section');
  support.append(el('h2', 'section-title', 'Support Ext-Ray'));
  support.append(el('p', 'note',
    'Ext-Ray is free and runs entirely on your device. If it’s useful, a Bitcoin donation helps keep it maintained.'));
  const btcRow = el('div', 'btc-row');
  const copyBtn = el('button', 'btn-copy', 'Copy');
  copyBtn.dataset.copy = BTC_ADDRESS;
  btcRow.append(el('code', 'btc-address', BTC_ADDRESS), copyBtn);
  support.append(btcRow);
  root.append(support);
}
