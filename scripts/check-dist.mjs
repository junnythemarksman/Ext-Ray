// Asserts the built dist/ satisfies the MV3 "loadable" contract (design spec §4).
// Run after a build: `node scripts/check-dist.mjs` (or `npm run verify:build`).
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const dist = resolve('dist');
let failed = false;
const ok = (m) => console.log(`✓ ${m}`);
const fail = (m) => { console.error(`✗ ${m}`); failed = true; };

const manifestPath = resolve(dist, 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error('✗ dist/manifest.json missing — run `npm run build` first');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.manifest_version === 3 ? ok('manifest_version is 3') : fail('manifest_version is not 3');

const EXPECTED_PERMISSIONS = ['alarms', 'management', 'notifications', 'storage'];
const perms = [...(manifest.permissions ?? [])].sort();
JSON.stringify(perms) === JSON.stringify(EXPECTED_PERMISSIONS)
  ? ok(`permissions are exactly: ${EXPECTED_PERMISSIONS.join(', ')}`)
  : fail(`permissions must be exactly [${EXPECTED_PERMISSIONS.join(', ')}], got [${perms.join(', ')}]`);

'host_permissions' in manifest
  ? fail(`host_permissions present (${JSON.stringify(manifest.host_permissions)}) — Ext-Ray must request none`)
  : ok('no host_permissions (local-only)');

'externally_connectable' in manifest
  ? fail('externally_connectable present — must be absent')
  : ok('no externally_connectable');

manifest.background?.type === 'module'
  ? ok('background.type is module')
  : fail(`background.type must be 'module', got ${JSON.stringify(manifest.background?.type)}`);

const referenced = [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  manifest.options_page,
  ...Object.values(manifest.icons ?? {}),
].filter(Boolean);
for (const rel of referenced) {
  existsSync(resolve(dist, rel)) ? ok(`exists: ${rel}`) : fail(`manifest references missing file: ${rel}`);
}

// Phase 9: the onboarding page is opened by the SW (not referenced by the manifest).
existsSync(resolve(dist, 'onboarding/index.html'))
  ? ok('exists: onboarding/index.html')
  : fail('onboarding/index.html missing from dist');

const swRel = manifest.background?.service_worker;
const sw = swRel ? resolve(dist, swRel) : '';
if (sw && existsSync(sw)) {
  const swSource = readFileSync(sw, 'utf8');
  swSource.length > 0 ? ok('service worker is non-empty') : fail('service worker is empty');
  // Self-containment: a module SW must not import sibling chunks (the MV3 dynamic-import
  // footgun the two-pass build exists to prevent). A self-contained bundle has no `from '...'`.
  /\bfrom\s*['"]/.test(swSource)
    ? fail('service worker is not self-contained (imports a sibling chunk)')
    : ok('service worker is self-contained');
} else {
  fail('service worker missing');
}

if (failed) {
  console.error('check-dist: FAILED');
  process.exit(1);
}
console.log('check-dist: OK');
