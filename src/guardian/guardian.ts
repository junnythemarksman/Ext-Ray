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
