// snapshot/ — pure diff engine (design spec §5.2). No I/O.
//
// Detects what changed between two scans of the installed extensions. The
// guardian's whole value (validated by the 2024–25 Cyberhaven / RedDirection
// supply-chain wave) is catching the SILENT post-install change of an
// already-trusted extension — so this fires on any meaningful delta, not just
// "gained a scary permission."
//
// Invariants:
//   • First run (empty `prev`) ⇒ only `installed` changes, never spurious
//     "changed" alerts (spec §8).
//   • Deterministic: same inputs ⇒ same output, in a stable order.
//   • O(P + C) time (P = prev count, C = curr count); no nested scans.

import type { ExtSnapshot, Change } from '../types';
import { trace } from '../debug';

const tGuardian = trace('sec.guardian');

/** Union of an extension's API permissions and host patterns — the capability set. */
const capabilitySet = (e: ExtSnapshot): Set<string> =>
  new Set([...e.permissions, ...e.hostPermissions]);

/** Items in `after` that are not in `before`, preserving `after`'s order. */
const addedItems = (before: Set<string>, after: Iterable<string>): string[] =>
  [...new Set(after)].filter((x) => !before.has(x));

export function diff(prev: ExtSnapshot[], curr: ExtSnapshot[]): Change[] {
  const prevById = new Map(prev.map((e) => [e.id, e]));
  const currIds = new Set(curr.map((e) => e.id));
  const changes: Change[] = [];

  for (const e of curr) {
    const before = prevById.get(e.id);
    if (!before) {
      // First sight of this extension — install only, no deltas (spec §8).
      changes.push({ kind: 'installed', id: e.id, name: e.name });
      continue;
    }

    const beforeCaps = capabilitySet(before);
    const afterCaps = capabilitySet(e);
    const added = addedItems(beforeCaps, afterCaps);
    const removed = addedItems(afterCaps, beforeCaps);

    if (added.length) changes.push({ kind: 'permissions-added', id: e.id, name: e.name, permissions: added });
    if (removed.length) changes.push({ kind: 'permissions-removed', id: e.id, name: e.name, permissions: removed });
    if (before.version !== e.version) {
      changes.push({ kind: 'version-changed', id: e.id, name: e.name, from: before.version, to: e.version });
    }
    if (before.updateUrl !== e.updateUrl) {
      changes.push({ kind: 'publisher-changed', id: e.id, name: e.name, from: before.updateUrl, to: e.updateUrl });
    }
  }

  for (const e of prev) {
    if (!currIds.has(e.id)) changes.push({ kind: 'removed', id: e.id, name: e.name });
  }

  if (tGuardian.enabled) {
    const kinds: Record<string, number> = {};
    for (const c of changes) kinds[c.kind] = (kinds[c.kind] ?? 0) + 1;
    tGuardian('diffed snapshots', { prev: prev.length, curr: curr.length, changes: changes.length, kinds });
  }

  return changes;
}
