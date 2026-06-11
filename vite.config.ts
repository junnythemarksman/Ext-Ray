import { defineConfig } from 'vitest/config';

// Hand-rolled MV3 build (design spec §3.1). Two passes share this file, selected
// by BUILD_TARGET, and write into one dist/:
//   pages (default): multi-input popup/options; publicDir copies manifest + icons;
//                    emptyOutDir wipes dist first.
//   sw  (BUILD_TARGET=sw): single-input service worker, inlineDynamicImports → one
//                    self-contained background/index.js; appends (emptyOutDir:false).
// `npm test` sets no BUILD_TARGET and ignores the `build`/`publicDir` fields entirely.
const isSw = process.env.BUILD_TARGET === 'sw';

export default defineConfig({
  base: './',
  publicDir: isSw ? false : 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: !isSw,
    target: 'esnext',
    modulePreload: false,
    rollupOptions: isSw
      ? {
          input: { background: 'src/background/index.ts' },
          output: {
            // keep here — hoisting to a shared output breaks the multi-entry pages pass
            inlineDynamicImports: true,
            entryFileNames: 'background/index.js',
          },
        }
      : {
          input: { popup: 'popup/index.html', options: 'options/index.html', onboarding: 'onboarding/index.html' },
          output: {
            entryFileNames: 'assets/[name]-[hash].js',
            chunkFileNames: 'assets/[name]-[hash].js',
            assetFileNames: 'assets/[name]-[hash][extname]',
          },
        },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
