// signals/ — pure informational-signal engine (signal-pack spec §4.5). No I/O.
//
// Signals are CONTEXT, never verdicts: zero score weight, never change a tier,
// rendered in their own muted lane (the Amazon-Inspector "informational" model —
// reported, never summed). Domain: a normalized fleet snapshot. Codomain: each
// id → 0–3 short plain-English strings. O(N) over the fleet; deterministic; no clock.

import type { ExtSnapshot } from '../types';

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
  const byHost = new Map<string, string[]>();
  for (const e of snapshots) {
    const host = updateHost(e.updateUrl);
    if (host !== null && !STORE_HOSTS.has(host)) {
      byHost.set(host, [...(byHost.get(host) ?? []), e.id]);
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
      const peers = (byHost.get(host)?.length ?? 1) - 1;
      if (peers >= 1) {
        signals.push(
          `Updates from the same server (${host}) as ${peers} other installed extension${peers === 1 ? '' : 's'} — could be one developer or one operator`,
        );
      }
    }
    out.set(e.id, signals);
  }
  return out;
}
