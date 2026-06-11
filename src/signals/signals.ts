// signals/ — pure informational-signal engine (signal-pack spec §4.5). No I/O.
//
// Signals are CONTEXT, never verdicts: zero score weight, never change a tier,
// rendered in their own muted lane (the Amazon-Inspector "informational" model —
// reported, never summed). Domain: a normalized fleet snapshot. Codomain: each
// id → 0–3 short plain-English strings. O(N) over the fleet; deterministic; no clock.

import type { ExtSnapshot } from '../types';
import { trace } from '../debug';

const tSignals = trace('calc.signals');

/** Official store update hosts — Chrome Web Store and Edge Add-ons (Ext-Ray runs on both;
 *  allowlisting only CWS would flag an entire Edge fleet — alert-fatigue by design error). */
const STORE_HOSTS = new Set(['clients2.google.com', 'edge.microsoft.com']);

/** Hostname of a declared updateUrl; null when absent (the normal CWS case — never a signal).
 *  A malformed URL (near-impossible from Chrome) safe-fails to '' — treated as non-store,
 *  over-noting rather than under-noting (same philosophy as scoring's hostWeight). */
function updateHost(updateUrl: string | undefined): string | null {
  if (!updateUrl) return null;
  try {
    return new URL(updateUrl).hostname;
  } catch {
    return '';
  }
}

/** Informational, unscored signals per extension. Every input id gets an entry (possibly []). */
export function fleetSignals(snapshots: ExtSnapshot[]): Map<string, string[]> {
  // Pass 1: group ids by non-store update host for the cluster signal.
  // '' (malformed) still gets the non-store note in pass 2 but never clusters.
  const byHost = new Map<string, string[]>();
  for (const e of snapshots) {
    const host = updateHost(e.updateUrl);
    if (host !== null && host !== '' && !STORE_HOSTS.has(host)) {
      let group = byHost.get(host);
      if (!group) byHost.set(host, (group = []));
      group.push(e.id);
    }
  }

  // Pass 2: per-extension signal strings (exact copy from spec §4.5).
  const out = new Map<string, string[]>();
  for (const e of snapshots) {
    const signals: string[] = [];
    if (!e.enabled && e.disabledReason === 'permissions_increase') {
      signals.push('Chrome disabled this extension: an update requested more permissions');
    }
    const host = updateHost(e.updateUrl);
    if (host !== null && !STORE_HOSTS.has(host)) {
      signals.push(
        e.installType === 'admin'
          ? 'Updates from outside the official extension store (enterprise-managed installs commonly self-host)'
          : 'Updates from outside the official extension store',
      );
      // For a malformed ('') host there is no byHost entry — ?? 1 yields peers = 0, no cluster line.
      const peers = (byHost.get(host)?.length ?? 1) - 1;
      if (peers >= 1) {
        signals.push(
          `Updates from the same server (${host}) as ${peers} other installed extension${peers === 1 ? '' : 's'} — could be one developer or one operator`,
        );
      }
    }
    out.set(e.id, signals);
  }

  if (tSignals.enabled) {
    let withSignals = 0;
    for (const s of out.values()) if (s.length > 0) withSignals += 1;
    tSignals('fleet signals computed', { n: snapshots.length, withSignals, clusteredHosts: byHost.size });
  }

  return out;
}
