// report/ — pure popup view-model builder (design spec §3.1). No I/O.
// Scores each extension, grades the fleet, sorts worst-first, and partitions
// into full "risky" cards (tier ≥ medium) and compact "low" rows. All popup
// logic lives here so the render layer is a dumb data→DOM map.
// Invariant: risky.length + low.length === snapshots.length; both lists are worst-first
// (score desc, name tiebreak); deterministic — no clock, no locale-sensitive compare.

import type { ExtSnapshot, ReportView, ReportCard, ReportRow } from '../types';
import { scoreExtension, gradeFleet } from '../scoring/scoring';

// Locale-independent compare — keeps the sort deterministic across environments.
const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function buildReport(snapshots: ExtSnapshot[]): ReportView {
  const scored = snapshots.map((snapshot) => ({ snapshot, verdict: scoreExtension(snapshot) }));
  const grade = gradeFleet(scored.map((x) => x.verdict));

  // Worst-first: score descending, ties broken by name ascending (determinism).
  scored.sort((a, b) => b.verdict.score - a.verdict.score || byName(a.snapshot.name, b.snapshot.name));

  const risky: ReportCard[] = [];
  const low: ReportRow[] = [];
  for (const { snapshot, verdict } of scored) {
    if (verdict.tier === 'low') {
      low.push({
        id: snapshot.id, name: snapshot.name, tier: verdict.tier,
        enabled: snapshot.enabled, canDisable: snapshot.mayDisable,
      });
    } else {
      risky.push({
        id: snapshot.id, name: snapshot.name, version: snapshot.version, tier: verdict.tier,
        score: verdict.score, reasons: verdict.reasons,
        enabled: snapshot.enabled, canDisable: snapshot.mayDisable,
      });
    }
  }

  return { grade, risky, low, counts: { total: snapshots.length, risky: risky.length, low: low.length } };
}
