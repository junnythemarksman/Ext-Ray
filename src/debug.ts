// Debug & trace instrumentation — one layer, zero-cost when off.
//
// Three independent namespaces (per the project's debug-instrumentation doctrine),
// each toggleable on its own so they can be enabled in isolation:
//   sec.*   — security/authz decisions (guardian change verdicts, never the secret)
//   perf.*  — timing spans, scan throughput, cache hit/miss
//   calc.*  — numeric-algorithm inputs/intermediates/outputs + domain/codomain checks
//
// Enable without a redeploy, via either source (env wins, then localStorage):
//   Node / Vitest:        EXTRAY_DEBUG=calc.*           npm test
//   Browser devtools:     localStorage.extray_debug = 'sec.*,perf.*'
//
// Specs are comma-separated patterns. A pattern is one of:
//   '*'        — everything
//   'calc.*'   — every calc.<sub> namespace (family wildcard)
//   'calc.score' — that exact namespace only
//
// Production default is off for every namespace; nothing is logged until a
// spec matches. Never pass secrets, PII, or full payloads to a trace — log
// shape/size/decision only.

/** Pure: does `spec` enable `namespace`? Exported for testing the toggle itself. */
export function matchesSpec(spec: string, namespace: string): boolean {
  if (!spec) return false;
  return spec
    .split(',')
    .map((p) => p.trim())
    .some((pattern) => {
      if (!pattern) return false;
      if (pattern === '*') return true;
      if (pattern.endsWith('.*')) {
        const family = pattern.slice(0, -2); // 'calc.*' -> 'calc'
        return namespace === family || namespace.startsWith(family + '.');
      }
      return pattern === namespace;
    });
}

function readSpec(): string {
  // env (Node / Vitest) takes precedence — set per test run.
  if (typeof process !== 'undefined' && process.env && process.env.EXTRAY_DEBUG) {
    return process.env.EXTRAY_DEBUG;
  }
  // browser devtools toggle — flippable at runtime, no redeploy.
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    return ls?.getItem('extray_debug') ?? '';
  } catch {
    // localStorage can throw in restricted contexts (e.g. some SW states).
    return '';
  }
}

export interface Trace {
  (msg: string, fields?: Record<string, unknown>): void;
  /** Guard expensive field-building: `if (trace.enabled) trace('x', heavy())`. */
  readonly enabled: boolean;
}

let currentSpec = readSpec();
const registry: Array<{ namespace: string; setEnabled: (on: boolean) => void }> = [];

/** Create a namespaced trace logger. Zero-cost when its namespace is disabled. */
export function trace(namespace: string): Trace {
  let enabled = matchesSpec(currentSpec, namespace);
  const fn = ((msg: string, fields?: Record<string, unknown>): void => {
    if (!enabled) return;
    const tag = `[${namespace}]`;
    if (fields) console.debug(tag, msg, fields);
    else console.debug(tag, msg);
  }) as Trace & { enabled: boolean };
  Object.defineProperty(fn, 'enabled', { get: () => enabled });
  registry.push({ namespace, setEnabled: (on) => (enabled = on) });
  return fn;
}

/** Re-read the enable spec and re-evaluate every live logger (no redeploy needed). */
export function refreshDebug(): void {
  currentSpec = readSpec();
  for (const entry of registry) {
    entry.setEnabled(matchesSpec(currentSpec, entry.namespace));
  }
}
