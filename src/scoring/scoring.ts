// scoring/ — pure risk engine (design spec §5.1). No I/O.
//
// Bounds (enforced + asserted via calc.* traces):
//   • scoreExtension → score ∈ [0, 1]
//   • monotonic in permission danger (more/worse permissions never lower the score)
//   • gradeFleet score ∈ [0, 1] and ≥ the worst single score (worst-case-weighted)
//   • deterministic; no NaN/overflow
//
// Time/space: O(P) per extension (P = permission count); O(N) per fleet. No nested
// scans — fine for N→large extension counts.

import type { ExtSnapshot, Verdict, FleetGrade, Tier, Grade } from '../types';
import { trace } from '../debug';
import {
  PERMISSION_WEIGHTS,
  DEFAULT_PERMISSION_WEIGHT,
  INSTALL_RISK_BUMP,
  DISABLED_FACTOR,
  TIER_THRESHOLDS,
  GRADE_THRESHOLDS,
} from './weights';

const tScore = trace('calc.score');
const tFleet = trace('calc.fleet');

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Danger of a single host match pattern. Host wildcard ⇒ effectively all sites. */
function hostWeight(pattern: string): number {
  if (pattern === '<all_urls>') return 1.0;
  const host = /^(?:\*|https?|wss?|ftp|file):\/\/([^/]*)\//.exec(pattern)?.[1] ?? '';
  if (host === '' || host === '*') return 1.0; // '*://*/*', 'https://*/*' — the whole web
  if (host.startsWith('*.')) return 0.6; // subdomain wildcard — broad
  return 0.4; // a specific host
}

const permissionWeight = (name: string): number =>
  PERMISSION_WEIGHTS[name] ?? DEFAULT_PERMISSION_WEIGHT;

function tierFor(score: number): Tier {
  for (const [cut, tier] of TIER_THRESHOLDS) if (score >= cut) return tier;
  return 'low';
}

/** Turn one extension's declared metadata into a risk verdict. */
export function scoreExtension(info: ExtSnapshot): Verdict {
  // Per-capability weights, paired with a label so we can explain the verdict.
  const weighted: Array<{ weight: number; label: string }> = [
    ...info.permissions.map((p) => ({ weight: permissionWeight(p), label: p })),
    ...info.hostPermissions.map((h) => ({ weight: hostWeight(h), label: h })),
  ];

  const base = weighted.reduce((max, w) => (w.weight > max ? w.weight : max), 0);
  const breadth = Math.min(0.15, 0.03 * weighted.filter((w) => w.weight >= 0.5).length);
  const installBump = INSTALL_RISK_BUMP[info.installType] ?? 0;
  const enabledFactor = info.enabled ? 1 : DISABLED_FACTOR;

  const score = clamp01((base + breadth + installBump) * enabledFactor);
  const tier = tierFor(score);

  if (score < 0 || score > 1 || Number.isNaN(score)) {
    tScore('BOUND VIOLATION — score outside [0,1]', { id: info.id, score });
  }
  tScore('scored extension', {
    id: info.id,
    perms: info.permissions.length,
    hosts: info.hostPermissions.length,
    base,
    breadth,
    installBump,
    enabledFactor,
    score,
    tier,
  });

  return { tier, score, reasons: reasonsFor(info, weighted, installBump) };
}

function reasonsFor(
  info: ExtSnapshot,
  weighted: Array<{ weight: number; label: string }>,
  installBump: number,
): string[] {
  const reasons: string[] = [];
  const top = [...weighted].sort((a, b) => b.weight - a.weight).slice(0, 3);
  for (const { weight, label } of top) {
    if (label.startsWith('file://')) {
      reasons.push('Can read your local files');
    } else if (weight >= 1.0 && (label === '<all_urls>' || /:\/\//.test(label))) {
      reasons.push('Can read and change your data on all websites');
    } else if (weight >= 0.6 && /:\/\//.test(label)) {
      reasons.push(`Can access ${label}`);
    } else if (weight >= 0.7) {
      reasons.push(`Requests the powerful "${label}" permission`);
    } else if (weight >= 0.3) {
      // Floor aligned with the medium tier cutoff (TIER_THRESHOLDS, 0.3) so a
      // medium verdict always has an explaining reason — never the "Minimal
      // permissions" fallback. Covers clipboardWrite and unknown permissions (0.3).
      reasons.push(`Requests "${label}"`);
    }
  }
  if (installBump > 0) {
    reasons.push(`Installed outside the Web Store (${info.installType})`);
  }
  if (!info.enabled) reasons.push('Currently disabled');
  if (reasons.length === 0) reasons.push('Minimal permissions — low risk');
  return [...new Set(reasons)];
}

const gradeFor = (score: number): Grade => {
  for (const [cut, grade] of GRADE_THRESHOLDS) if (score >= cut) return grade;
  return 'A';
};

/**
 * Worst-case-weighted fleet grade: anchored at the worst single score so safe
 * extensions can never dilute one dangerous one, then nudged upward by the
 * average of the rest. Guarantees score ≥ max single score and ∈ [0, 1].
 */
export function gradeFleet(verdicts: Verdict[]): FleetGrade {
  if (verdicts.length === 0) return { grade: 'A', score: 0 };

  const scores = verdicts.map((v) => v.score);
  const maxScore = Math.max(...scores);
  const worstIdx = scores.indexOf(maxScore);
  const rest = scores.filter((_, i) => i !== worstIdx);
  const avgRest = rest.length ? rest.reduce((a, b) => a + b, 0) / rest.length : 0;

  const score = clamp01(maxScore + (1 - maxScore) * avgRest * 0.5);
  const grade = gradeFor(score);

  tFleet('graded fleet', { n: verdicts.length, maxScore, avgRest, score, grade });
  return { grade, score };
}
