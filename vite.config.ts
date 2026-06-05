import { defineConfig } from 'vitest/config';

// Vitest config for the pure engines. The pure engines need no DOM, so the
// default test environment is `node`. The MV3 production build (popup/options/
// background bundling) lands with the glue milestone, per the design spec §5.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
