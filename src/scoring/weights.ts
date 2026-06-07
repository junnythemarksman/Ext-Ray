// ─────────────────────────────────────────────────────────────────────────────
// DOMAIN-JUDGMENT TABLE — this is the one place product feel is authored.
//
// Each weight is the danger of a granted capability, on [0, 1] (1 = able to do
// the most harm). These are an opinionated *starting point*; tuning them is what
// makes Ext-Ray's grades feel right. Edit freely — the engine and tests treat
// this table as data, not logic.
//
// Sources for the rankings (capabilities, not CVEs): Chrome permission warnings
// reference + the declared-permission risk that drove the 2024–25 attacks.
// ─────────────────────────────────────────────────────────────────────────────

/** API-permission → danger weight. Unlisted permissions fall back to the default. */
export const PERMISSION_WEIGHTS: Readonly<Record<string, number>> = {
  // Full code / traffic control — the scariest non-host capabilities.
  debugger: 1.0,
  userScripts: 0.9, // MV3 remote-code exception: runs arbitrary user-supplied code; Chrome gates it behind a dedicated per-extension toggle
  proxy: 0.9,
  nativeMessaging: 0.9,
  webRequestBlocking: 0.85,
  scripting: 0.8,
  webRequest: 0.8,
  declarativeNetRequest: 0.8,
  management: 0.8, // can see/affect other extensions (what Ext-Ray itself uses)

  // Reads or alters sensitive user data.
  cookies: 0.7,
  history: 0.7,
  privacy: 0.7,
  geolocation: 0.6,
  clipboardRead: 0.6,
  contentSettings: 0.6,
  tabs: 0.5, // tab URLs/titles across the browser
  downloads: 0.5,
  bookmarks: 0.4,

  // Low-risk, narrow-scope capabilities.
  clipboardWrite: 0.3,
  activeTab: 0.2,
  storage: 0.1,
  unlimitedStorage: 0.1,
  notifications: 0.1,
  contextMenus: 0.1,
  alarms: 0.05,
};

/** Unknown / unlisted permission — treated as moderate, never ignored. */
export const DEFAULT_PERMISSION_WEIGHT = 0.3;

/** Install sources that increase risk (not vetted by the Web Store review). */
export const INSTALL_RISK_BUMP: Readonly<Record<string, number>> = {
  development: 0.15,
  sideload: 0.15,
  other: 0.1,
  // 'admin' (enterprise policy) and 'normal' (Web Store) add nothing.
};

/** A disabled extension can't act right now, so its live risk is discounted. */
export const DISABLED_FACTOR = 0.85;

/** Score → individual tier cutoffs (inclusive lower bounds). */
export const TIER_THRESHOLDS: ReadonlyArray<readonly [number, 'critical' | 'high' | 'medium' | 'low']> = [
  [0.8, 'critical'],
  [0.55, 'high'],
  [0.3, 'medium'],
  [0, 'low'],
];

/**
 * Fleet score → letter-grade cutoffs (inclusive lower bounds), aligned with the
 * tier cutoffs above: a fleet whose worst extension never reaches 'medium' (0.3)
 * earns an A; one 'critical' extension (≥0.8) forces an F regardless of the rest.
 */
export const GRADE_THRESHOLDS: ReadonlyArray<readonly [number, 'F' | 'D' | 'C' | 'B' | 'A']> = [
  [0.8, 'F'],
  [0.6, 'D'],
  [0.45, 'C'],
  [0.3, 'B'],
  [0, 'A'],
];
