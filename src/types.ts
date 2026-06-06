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
