// options/render.ts — dumb data→DOM map (design spec §3.3). No logic beyond mapping;
// built with createElement so extension names are never interpreted as HTML. Phase 8 tested.

import type { Settings, ExtSnapshot } from '../src/types';

const CADENCE_PRESETS = [1, 5, 15, 30, 60];

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

function ignoreRow(ext: ExtSnapshot, ignored: boolean): HTMLElement {
  const row = el('label', 'row');
  const box = checkbox(ignored);
  box.dataset.ignore = ext.id;
  row.append(box, el('span', 'label', ext.name));
  return row;
}

export function renderOptions(
  settings: Settings,
  extensions: ExtSnapshot[] | null, // null = couldn't read the extension list
  ignored: string[],
  root: HTMLElement,
): void {
  const ignoredSet = new Set(ignored);
  root.className = 'options';
  root.replaceChildren();

  root.append(el('h1', 'title', 'Ext-Ray — Settings'));
  root.append(settingRow('monitoring', 'Watch for changes in the background', settings.monitoringEnabled));
  root.append(cadenceRow(settings.scanIntervalMinutes));
  root.append(settingRow('notify', 'Notify me when something changes', settings.notify));

  const section = el('section', 'ignore-section');
  section.append(el('h2', 'section-title', 'Ignore alerts from'));
  if (extensions === null) {
    section.append(el('p', 'note', 'Couldn’t read your extensions.'));
  } else if (extensions.length === 0) {
    section.append(el('p', 'note', 'No other extensions installed.'));
  } else {
    for (const ext of extensions) section.append(ignoreRow(ext, ignoredSet.has(ext.id)));
  }
  root.append(section);
}
