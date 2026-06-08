import { defineConfig } from '@playwright/test';

// Extension E2E: serial + stateful persistent context. The browser channel/headless
// and extension-loading flags live in e2e/fixtures.ts (launchPersistentContext), not here,
// because the default `browser`/`page` fixtures cannot load an unpacked extension.
export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: {
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium' }],
});
