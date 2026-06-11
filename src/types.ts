// Shared contract between the pure engines and the chrome.* edges.
//
// `ExtSnapshot` is the normalized projection of chrome.management.ExtensionInfo
// (design spec §7) that both the scoring and snapshot engines consume. Keeping
// this projection separate decouples the pure engines from the raw API shape.

export interface ExtSnapshot {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  /** chrome.management ExtensionInfo.type, e.g. 'extension' | 'theme' | 'hosted_app' | 'packaged_app'. */
  type: string;
  /** 'admin' | 'development' | 'normal' | 'sideload' | 'other'. */
  installType: string;
  permissions: string[];
  hostPermissions: string[];
  mayDisable: boolean;
  updateUrl?: string;
  /** Best icon URL (chrome://extension-icon/…) picked at the management edge; display-only —
   *  never part of diff() change detection (internal URLs may churn). */
  iconUrl?: string;
  /** chrome.management ExtensionInfo.disabledReason — enum is exactly 'unknown' |
   *  'permissions_increase'. Only 'permissions_increase' is actionable (Chrome itself
   *  disabled the extension because an update requested more permissions). Optional +
   *  additive: old stored snapshots lack it; no schema migration needed. */
  disabledReason?: string;
}

export type Tier = 'critical' | 'high' | 'medium' | 'low';

export interface Verdict {
  tier: Tier;
  /** Risk score, normalized to [0, 1]. */
  score: number;
  /** Plain-English reasons, most significant first. */
  reasons: string[];
}

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface FleetGrade {
  grade: Grade;
  /** Aggregate fleet risk, normalized to [0, 1]; ≥ the worst single score. */
  score: number;
}

// A single difference the guardian detected between two scans (design spec §5.2).
//
// `permissions-added` / `permissions-removed` report the UNION delta of an
// extension's API `permissions` and `hostPermissions` — host patterns are
// self-identifying (they contain "://" or are "<all_urls>"), so host-scope
// expansion (the highest-signal silent-update change) is captured here without a
// separate Change kind. `publisher-changed` is an `updateUrl` change.
//
// NOTE (honest scope limit): chrome.management.getAll() exposes only a subset of
// the manifest — NOT content_scripts.matches, web_accessible_resources, or
// declarative_net_request rules — so this engine can diff aggregate permissions
// and host scope, but cannot see the specific content-script that a malicious
// update injects. It flags the version bump that delivered it, not the payload.
export type Change =
  | { kind: 'installed'; id: string; name: string }
  | { kind: 'removed'; id: string; name: string }
  | { kind: 'permissions-added'; id: string; name: string; permissions: string[] }
  | { kind: 'permissions-removed'; id: string; name: string; permissions: string[] }
  | { kind: 'version-changed'; id: string; name: string; from: string; to: string }
  | { kind: 'publisher-changed'; id: string; name: string; from?: string; to?: string };

// Guardian configuration (design spec §5.6), persisted via storage/.
export interface Settings {
  /** Whether the background guardian re-scans on a timer. */
  monitoringEnabled: boolean;
  /** Re-scan cadence in minutes (spec §4.4: a few minutes is ample; min alarm 30s). */
  scanIntervalMinutes: number;
  /** Whether meaningful changes raise a chrome.notifications alert. */
  notify: boolean;
}

// Per-extension timestamps the guardian self-tracks over time (spec §5.3, §12).
// chrome.management has no "last updated" field, so Ext-Ray derives staleness and
// the "version bump after long stability" signal from these. Epoch milliseconds.
export interface ExtTimestamps {
  firstSeen: number;
  lastVersionChange: number;
}

// ── Phase 4: background guardian ──────────────────────────────────────────────

export type Severity = 'info' | 'notable' | 'high';

export interface ClassifiedChange {
  change: Change;
  severity: Severity;
}

// Everything the pure guardian core needs to evaluate one scan. `now` is injected
// (never read from a clock inside the pure core) so the core stays deterministic.
export interface ScanInput {
  prev: ExtSnapshot[];
  curr: ExtSnapshot[];
  timestamps: Record<string, ExtTimestamps>;
  settings: Settings;
  trusted: string[];
  now: number;
}

export interface ScanResult {
  timestamps: Record<string, ExtTimestamps>;        // new map to persist
  classified: ClassifiedChange[];                    // all non-suppressed changes + severity
  notification: { title: string; message: string } | null; // batched; null = stay silent
  revokeTrust: string[];   // trusted ids whose trust a material change voided
}

// ── Phase 6: popup report view model ──────────────────────────────────────────

export interface ReportCard {
  id: string;
  name: string;
  version: string;
  tier: Tier;          // 'critical' | 'high' | 'medium' (cards are tier ≥ medium)
  score: number;       // [0,1]
  reasons: string[];
  enabled: boolean;
  canDisable: boolean; // = mayDisable
  iconUrl?: string;
}

export interface ReportRow {
  id: string;
  name: string;
  tier: Tier;          // 'low'
  enabled: boolean;
  canDisable: boolean;
  iconUrl?: string;
}

export interface ReportView {
  grade: FleetGrade;
  risky: ReportCard[]; // worst-first
  low: ReportRow[];    // worst-first
  trusted: ReportCard[]; // trusted — excluded from the grade
  counts: { total: number; risky: number; low: number; trusted: number };
}

// ── Phase 7: options / alarm reconciliation ───────────────────────────────────

export type AlarmAction =
  | { kind: 'none' }
  | { kind: 'clear' }
  | { kind: 'create'; periodInMinutes: number };
