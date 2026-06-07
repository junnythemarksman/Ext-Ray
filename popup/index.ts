// popup/index.ts — controller glue (design spec §3.3). Loads the fleet, builds
// the report, renders it, wires actions via event delegation, and progressively
// fills in the browser's permission warnings for risky cards. No unit tests
// (chrome.* + DOM glue) — exercised in Phase 8.

import { getExtensions, getPermissionWarningsById, setEnabled, uninstall } from '../src/management/management';
import { buildReport } from '../src/report/report';
import { renderReport, renderError } from './render';

const root = document.getElementById('app') as HTMLElement;

// One delegated listener survives re-renders (root itself is never replaced).
root.addEventListener('click', (e) => void onClick(e));

async function onClick(e: MouseEvent): Promise<void> {
  const btn = (e.target as HTMLElement).closest('button[data-action]') as HTMLButtonElement | null;
  if (!btn) return;
  const item = btn.closest('[data-ext]') as HTMLElement | null;
  if (!item) return;
  const id = item.dataset.ext ?? '';

  if (btn.dataset.action === 'disable') {
    const nextEnabled = item.dataset.enabled !== 'true'; // toggle
    await setEnabled(id, nextEnabled);
    item.dataset.enabled = String(nextEnabled);
    item.classList.toggle('is-disabled', !nextEnabled);
    btn.textContent = nextEnabled ? 'Disable' : 'Enable';
  } else if (btn.dataset.action === 'remove') {
    try {
      await uninstall(id); // Chrome's native confirm; rejects if the user cancels
      item.remove();
    } catch {
      /* user cancelled — leave the item in place */
    }
  }
}

async function fillWarnings(ids: string[]): Promise<void> {
  await Promise.all(ids.map(async (id) => {
    try {
      const warnings = await getPermissionWarningsById(id);
      if (warnings.length === 0) return;
      const slot = root.querySelector(`.js-warning[data-id="${id}"]`);
      if (slot) slot.textContent = warnings[0]!;
    } catch {
      /* leave the card without a warning line */
    }
  }));
}

async function load(): Promise<void> {
  const snapshots = await getExtensions().catch(() => null);
  if (snapshots === null) {
    renderError(root, 'Couldn’t read your extensions.');
    return;
  }
  const view = buildReport(snapshots);
  renderReport(view, root);
  void fillWarnings(view.risky.map((card) => card.id));
}

void load();
