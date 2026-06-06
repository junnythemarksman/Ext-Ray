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

const referenced = [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  manifest.options_page,
  ...Object.values(manifest.icons ?? {}),
].filter(Boolean);
for (const rel of referenced) {
  existsSync(resolve(dist, rel)) ? ok(`exists: ${rel}`) : fail(`manifest references missing file: ${rel}`);
}

const swRel = manifest.background?.service_worker;
const sw = swRel ? resolve(dist, swRel) : '';
sw && existsSync(sw) && readFileSync(sw).length > 0
  ? ok('service worker is non-empty')
  : fail('service worker missing or empty');

if (failed) {
  console.error('check-dist: FAILED');
  process.exit(1);
}
console.log('check-dist: OK');
