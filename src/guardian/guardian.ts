// guardian/ — pure scan-evaluation engine (design spec §3.2). No I/O.
// Decides what changed, how serious it is, what to persist, and whether/what to
// notify — deterministically, from injected data. `now` is a parameter, never a clock.

import type {
  ExtSnapshot, Change, Severity, ClassifiedChange, ScanInput, ScanResult, ExtTimestamps,
} from '../types';
import { diff } from '../snapshot/snapshot';
import { scoreExtension } from '../scoring/scoring';
import { trace } from '../debug';

const tGuardian = trace('sec.guardian');

/** A version bump after this many stable days is treated as noteworthy. Tunable (spec §2). */
export const STABILITY_WINDOW_DAYS = 60;
const DAY_MS = 86_400_000;

/**
 * A scan is untrustworthy when the live read is empty but we hold a non-empty baseline — almost
 * always a transient chrome.management.getAll() race during service-worker/profile startup, not a
 * real mass-uninstall. Acting on it would diff every extension as 'removed' AND rebase the stored
 * snapshot to [], laundering any concurrent malicious change into a fresh "trusted" baseline. The
 * caller skips the scan entirely (no evaluate, no notify, no persist), preserving the prior snapshot.
 */
export const isUntrustworthyScan = (prev: ExtSnapshot[], curr: ExtSnapshot[]): boolean =>
  prev.length > 0 && curr.length === 0;

/** A diff-reported capability is a host match pattern (vs an API permission). */
const isHostPattern = (p: string): boolean => p === '<all_urls>' || p.includes('://');

export interface ClassifyCtx {
  currById: Map<string, ExtSnapshot>;
  prevTimestamps: Record<string, ExtTimestamps>;
  now: number;
}

export function classifySeverity(change: Change, ctx: ClassifyCtx): Severity {
  switch (change.kind) {
    case 'permissions-added':
      return change.permissions.some(isHostPattern) ? 'high' : 'notable';
    case 'publisher-changed':
      return 'high';
    case 'version-changed': {
      const last = ctx.prevTimestamps[change.id]?.lastVersionChange;
      return last !== undefined && ctx.now - last >= STABILITY_WINDOW_DAYS * DAY_MS ? 'notable' : 'info';
    }
    case 'installed': {
      const ext = ctx.currById.get(change.id);
      // defensive: diff() only emits `installed` for ids present in curr, so this is unreachable in practice
      if (!ext) return 'info';
      if (ext.installType === 'development' || ext.installType === 'sideload') return 'high';
      const tier = scoreExtension(ext).tier;
      return tier === 'critical' || tier === 'high' ? 'notable' : 'info';
    }
    case 'permissions-removed':
    case 'removed':
      return 'info';
  }
}

function nextTimestamps(
  prevTimestamps: Record<string, ExtTimestamps>,
  curr: ExtSnapshot[],
  changes: Change[],
  now: number,
): Record<string, ExtTimestamps> {
  const versionChanged = new Set(changes.filter((c) => c.kind === 'version-changed').map((c) => c.id));
  const next: Record<string, ExtTimestamps> = {};
  for (const e of curr) {
    const prevTs = prevTimestamps[e.id];
    next[e.id] = prevTs
      ? { firstSeen: prevTs.firstSeen, lastVersionChange: versionChanged.has(e.id) ? now : prevTs.lastVersionChange }
      : { firstSeen: now, lastVersionChange: now };
  }
  return next;
}

function describeChange(classified: ClassifiedChange): string {
  const { change } = classified;
  switch (change.kind) {
    case 'installed': return `${change.name} was installed`;
    case 'permissions-added': return `${change.name} gained: ${change.permissions.join(', ')}`;
    case 'publisher-changed': return `${change.name} changed its update source`;
    case 'version-changed': return `${change.name} updated after a long stable period`;
    case 'permissions-removed': return `${change.name} removed permissions`;
    case 'removed': return `${change.name} was removed`;
  }
}

function buildNotification(noteworthy: ClassifiedChange[]): { title: string; message: string } | null {
  if (noteworthy.length === 0) return null;
  const n = noteworthy.length;
  const title = `Ext-Ray: ${n} change${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} review`;
  const lines = noteworthy.slice(0, 5).map((c) => `• ${describeChange(c)}`);
  if (n > 5) lines.push(`…and ${n - 5} more`);
  return { title, message: lines.join('\n') };
}

export function evaluateScan(input: ScanInput): ScanResult {
  const { prev, curr, timestamps, settings, trusted, now } = input;
  const changes = diff(prev, curr);
  const newTimestamps = nextTimestamps(timestamps, curr, changes, now);

  // First run / baseline: establish silently, no notification storm (spec §6, §8).
  if (prev.length === 0) {
    if (tGuardian.enabled) tGuardian('baseline established', { curr: curr.length });
    return { timestamps: newTimestamps, classified: [], notification: null, revokeTrust: [] };
  }

  const trustedSet = new Set(trusted);
  const ctx: ClassifyCtx = { currById: new Map(curr.map((e) => [e.id, e])), prevTimestamps: timestamps, now };

  const classified: ClassifiedChange[] = [];
  const revokeTrust: string[] = [];
  const revoked = new Set<string>();
  for (const change of changes) {
    const severity = classifySeverity(change, ctx);
    if (trustedSet.has(change.id)) {
      // Trusted: silence benign (info) churn; a material change (notable/high) still alerts AND
      // voids trust so the extension reappears at its true tier next scan.
      if (severity === 'info') continue;
      if (!revoked.has(change.id)) { revoked.add(change.id); revokeTrust.push(change.id); }
    }
    classified.push({ change, severity });
  }

  const noteworthy = classified.filter((c) => c.severity !== 'info');
  const notification = settings.notify ? buildNotification(noteworthy) : null;

  if (tGuardian.enabled) {
    tGuardian('scan evaluated', {
      changes: classified.length, noteworthy: noteworthy.length, notified: notification !== null,
      revoked: revokeTrust.length, suppressed: changes.length - classified.length,
    });
  }
  return { timestamps: newTimestamps, classified, notification, revokeTrust };
}
