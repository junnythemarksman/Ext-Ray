// popup/render.ts — dumb data→DOM map (design spec §3.2). No logic beyond a
// static tier→label lookup; built with createElement/textContent so extension
// names and warnings are never interpreted as HTML. Verified in Phase 8.

import type { ReportView, ReportCard, ReportRow, Tier } from '../src/types';

const TIER_LABEL: Record<Tier, string> = {
  critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low',
};

const HONEST_LIMITS =
  'Ext-Ray flags what an extension can do, not proof it’s malicious — and can’t see its code or network activity.';

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderActions(enabled: boolean, canDisable: boolean): HTMLElement {
  const wrap = el('div', 'actions');
  if (!canDisable) {
    wrap.append(el('span', 'managed', 'managed by your organization'));
    return wrap;
  }
  const toggle = el('button', 'btn btn-disable', enabled ? 'Disable' : 'Enable');
  toggle.dataset.action = 'disable';
  const remove = el('button', 'btn btn-remove', 'Remove');
  remove.dataset.action = 'remove';
  wrap.append(toggle, remove);
  return wrap;
}

function renderCard(card: ReportCard): HTMLElement {
  const c = el('article', `card tier-${card.tier}`);
  c.dataset.ext = card.id;
  c.dataset.enabled = String(card.enabled);

  const head = el('div', 'card-head');
  head.append(
    el('span', 'dot'),
    el('span', 'tier-label', TIER_LABEL[card.tier]),
    el('span', 'name', card.name),
    el('span', 'version', `v${card.version}`),
  );
  c.append(head);

  for (const reason of card.reasons) c.append(el('p', 'reason', reason));

  const warning = el('p', 'warning js-warning');
  warning.dataset.id = card.id; // filled by the controller when the browser warning arrives
  c.append(warning);

  c.append(renderActions(card.enabled, card.canDisable));
  return c;
}

function renderRow(row: ReportRow): HTMLElement {
  const r = el('div', `row tier-${row.tier}`);
  r.dataset.ext = row.id;
  r.dataset.enabled = String(row.enabled);
  r.append(el('span', 'dot'), el('span', 'name', row.name));
  r.append(renderActions(row.enabled, row.canDisable));
  return r;
}

export function renderReport(view: ReportView, root: HTMLElement): void {
  root.className = 'report';
  root.replaceChildren();

  const header = el('header', 'header');
  header.append(el('div', `grade grade-${view.grade.grade.toLowerCase()}`, view.grade.grade));
  const meta = el('div', 'meta');
  meta.append(
    el('div', 'app-title', 'Ext-Ray'),
    el('div', 'summary',
      view.counts.total === 0
        ? 'No other extensions installed.'
        : `${view.counts.risky} need a look · ${view.counts.low} low-risk`),
  );
  header.append(meta);
  root.append(header);

  for (const card of view.risky) root.append(renderCard(card));

  if (view.low.length) {
    const section = el('section', 'low-section');
    section.append(el('h2', 'low-title', 'low-risk'));
    for (const row of view.low) section.append(renderRow(row));
    root.append(section);
  }

  root.append(el('footer', 'limits', HONEST_LIMITS));
}

export function renderError(root: HTMLElement, message: string): void {
  root.className = 'error';
  root.replaceChildren(el('p', 'error-msg', message));
}
