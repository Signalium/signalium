/// <reference types="@vitest/browser/providers/playwright" />

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import babel from 'vite-plugin-babel';
import { signaliumPreset } from 'signalium/transform';
import tsconfigPaths from 'vite-tsconfig-paths';
import module from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = module.createRequire(import.meta.url);

// Dynamically resolve React from node's module resolution (respects workspaces)
const reactPath = path.dirname(require.resolve('react/package.json'));
const reactDomPath = path.dirname(require.resolve('react-dom/package.json'));

export default defineConfig({
  define: {
    IS_DEV: 'true',
  },
  resolve: {
    // custom resolves for vitest so we don't need to use the main entry point
    alias: [
      // Use Node's module resolution to find React (respects npm workspaces)
      { find: 'react', replacement: reactPath },
      { find: 'react-dom', replacement: reactDomPath },
      {
        find: /^signalium$/,
        replacement: fileURLToPath(new URL('../signalium/src/index.ts', import.meta.url)),
      },
      {
        find: /^signalium\/utils$/,
        replacement: fileURLToPath(new URL('../signalium/src/utils.ts', import.meta.url)),
      },
      {
        find: /^signalium\/config$/,
        replacement: fileURLToPath(new URL('../signalium/src/config.ts', import.meta.url)),
      },
      {
        find: /^signalium\/debug$/,
        replacement: fileURLToPath(new URL('../signalium/src/debug.ts', import.meta.url)),
      },
      {
        find: /^signalium\/react$/,
        replacement: fileURLToPath(new URL('../signalium/src/react/index.ts', import.meta.url)),
      },
      {
        find: /^signalium\/transform$/,
        replacement: fileURLToPath(new URL('../signalium/src/transform/index.ts', import.meta.url)),
      },
    ],
    // Ensure React is deduplicated in monorepo
    dedupe: ['react', 'react-dom'],
    conditions: ['browser', 'development', 'module', 'import', 'default'],
  },
  optimizeDeps: {
    include: ['react', 'react/jsx-runtime', 'react-dom'],
  },
  ssr: {
    noExternal: ['react', 'react-dom'],
  },
  plugins: [
    tsconfigPaths(),
    {
      name: 'watch-signalium-src',
      configureServer(server) {
        server.watcher.add(path.resolve(__dirname, '../signalium/src'));
      },
    },
  ],
  test: {
    pool: 'threads',
    projects: [
      {
        extends: true,
        plugins: [
          (babel as any)({
            filter: /\.(j|t)sx?$/,
            babelConfig: {
              babelrc: false,
              configFile: false,
              sourceMaps: true,
              presets: [
                signaliumPreset({
                  transformedImports: [
                    ['testWithClient', /.*utils\.js$/],
                    ['watcher', 'signalium'],
                  ],
                }),
              ],
              parserOpts: {
                plugins: ['typescript'],
              },
            },
          }),
        ],
        test: {
          include: ['src/__tests__/**/*.test.ts'],
          exclude: ['src/react/**'],
          name: 'unit',
          environment: 'node',
        },
      },
      {
        extends: true,
        plugins: [
          react({
            babel: {
              presets: [signaliumPreset()],
            },
          }),
        ],
        test: {
          include: ['src/react/__tests__/**/*.test.tsx'],
          name: 'react',
          browser: {
            enabled: true,
            provider: 'playwright',
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
          // testTimeout: 2000,
        },
      },
    ],
  },
});
