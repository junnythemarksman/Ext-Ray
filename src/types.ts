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
