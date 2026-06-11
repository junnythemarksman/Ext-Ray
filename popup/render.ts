// popup/render.ts — dumb data→DOM map (design spec §3.2). No logic beyond a
// static tier→label lookup; built with createElement/textContent so extension
// names and warnings are never interpreted as HTML. Verified in Phase 8.

import type { ReportView, ReportCard, ReportRow, Tier, FleetGrade, Grade } from '../src/types';

const TIER_LABEL: Record<Tier, string> = {
  critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low',
};

const GRADE_WORDS: Record<Grade, string> = {
  A: 'Excellent', B: 'Good', C: 'Fair', D: 'Poor', F: 'At Risk',
};

const ICON_FALLBACK = '../icons/ext-fallback.svg';
const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag: string, attrs: Record<string, string>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

// Ring gauge (spec §3.2): SVG stroke ring, fill = fleet safety (A ≈ full, F ≈ minimal),
// arc colored by grade token. role=meter wrapper carries the semantics; SVG is decorative.
function buildGauge(grade: FleetGrade): HTMLElement {
  const C = 2 * Math.PI * 45; // r=45 in a 100×100 viewBox
  const wrap = el('div', `gauge grade-${grade.grade.toLowerCase()}`);
  wrap.setAttribute('role', 'meter');
  wrap.setAttribute('aria-valuemin', '0');
  wrap.setAttribute('aria-valuemax', '100');
  wrap.setAttribute('aria-valuenow', String(Math.round((1 - grade.score) * 100)));
  wrap.setAttribute('aria-valuetext', `${grade.grade} – ${GRADE_WORDS[grade.grade]}`);
  wrap.setAttribute('aria-labelledby', 'gauge-letter');

  const svg = svgEl('svg', { viewBox: '0 0 100 100', 'aria-hidden': 'true' });
  svg.append(svgEl('circle', { class: 'gauge-track', cx: '50', cy: '50', r: '45' }));
  const g = svgEl('g', { class: 'gauge-glow' });
  const arc = svgEl('circle', { class: 'gauge-arc', cx: '50', cy: '50', r: '45' });
  (arc as SVGCircleElement).style.setProperty('stroke-dasharray', String(C));
  // offset = C×score (capped so even an F keeps a visible 4% arc)
  (arc as SVGCircleElement).style.setProperty('stroke-dashoffset', String(Math.min(C * 0.96, C * grade.score)));
  g.append(arc);
  svg.append(g);
  wrap.append(svg);

  const overlay = el('div', 'gauge-text');
  const letter = el('span', `grade grade-${grade.grade.toLowerCase()}`, grade.grade);
  letter.id = 'gauge-letter';
  overlay.append(letter, el('span', 'grade-word', GRADE_WORDS[grade.grade]));
  wrap.append(overlay);
  return wrap;
}

function iconImg(url: string | undefined, size: number): HTMLImageElement {
  const img = document.createElement('img');
  img.className = 'ext-icon';
  img.width = size;
  img.height = size;
  img.alt = '';
  img.src = url ?? ICON_FALLBACK;
  img.addEventListener('error', () => { img.src = ICON_FALLBACK; }, { once: true });
  return img;
}

const HONEST_LIMITS =
  'Ext-Ray flags what an extension can do, not proof it’s malicious — and can’t see its code or network activity.';

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderActions(enabled: boolean, canDisable: boolean, trustAction?: 'trust' | 'untrust'): HTMLElement {
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
  if (trustAction) {
    const t = el('button', 'btn btn-trust', trustAction === 'trust' ? 'Trust' : 'Untrust');
    t.dataset.action = trustAction;
    wrap.append(t);
  }
  return wrap;
}

function renderCard(card: ReportCard): HTMLElement {
  const c = el('article', `card tier-${card.tier}`);
  c.dataset.ext = card.id;
  c.dataset.enabled = String(card.enabled);
  if (!card.enabled) c.classList.add('is-disabled');

  const head = el('div', 'card-head');
  head.append(
    iconImg(card.iconUrl, 32),
    el('span', 'dot'),
    el('span', 'tier-label', TIER_LABEL[card.tier]),
    el('span', 'name', card.name),
    el('span', 'version', `v${card.version}`),
  );
  c.append(head);

  for (const reason of card.reasons) c.append(el('p', 'reason', reason));
  for (const signal of card.signals) c.append(el('p', 'signal', signal));

  const warning = el('p', 'warning js-warning');
  warning.dataset.id = card.id; // filled by the controller when the browser warning arrives
  c.append(warning);

  c.append(renderActions(card.enabled, card.canDisable, 'trust'));
  return c;
}

function renderRow(row: ReportRow): HTMLElement {
  const r = el('div', `row tier-${row.tier}`);
  r.dataset.ext = row.id;
  r.dataset.enabled = String(row.enabled);
  if (!row.enabled) r.classList.add('is-disabled');
  r.append(iconImg(row.iconUrl, 24), el('span', 'dot'), el('span', 'name', row.name));
  for (const signal of row.signals) r.append(el('p', 'signal', signal));
  r.append(renderActions(row.enabled, row.canDisable));
  return r;
}

export function renderReport(view: ReportView, root: HTMLElement): void {
  root.className = 'report';
  root.replaceChildren();

  const header = el('header', 'header');
  header.append(buildGauge(view.grade));
  const meta = el('div', 'meta');
  const title = el('div', 'app-title');
  const logo = document.createElement('img');
  logo.src = '../icons/icon-32.png'; logo.width = 20; logo.height = 20; logo.alt = '';
  title.append(logo, document.createTextNode('Ext-Ray'));
  meta.append(
    title,
    el('div', 'summary',
      view.counts.total === 0
        ? 'No other extensions installed.'
        : `${view.counts.risky} need a look · ${view.counts.low} low-risk${view.counts.trusted ? ` · ${view.counts.trusted} trusted (excluded)` : ''}`),
    el('div', 'grade-caption', 'Overall security grade'),
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

  if (view.trusted.length) {
    const section = el('section', 'trusted-section');
    section.append(el('h2', 'trusted-title', 'trusted'));
    for (const t of view.trusted) {
      const r = el('div', `row tier-${t.tier} is-trusted`);
      r.dataset.ext = t.id;
      r.dataset.enabled = String(t.enabled);
      r.append(iconImg(t.iconUrl, 24), el('span', 'dot'), el('span', 'name', t.name),
        el('span', 'tier-label', TIER_LABEL[t.tier]));
      for (const signal of t.signals) r.append(el('p', 'signal', signal));
      r.append(renderActions(t.enabled, t.canDisable, 'untrust'));
      section.append(r);
    }
    root.append(section);
  }

  root.append(el('footer', 'limits', HONEST_LIMITS));
}

export function renderError(root: HTMLElement, message: string): void {
  root.className = 'error';
  root.replaceChildren(el('p', 'error-msg', message));
}
