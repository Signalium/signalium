/// <reference types="@vitest/browser/providers/playwright" />

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import babel from 'vite-plugin-babel';
import { signaliumPreset } from './src/transform/index.js';
import { fileURLToPath } from 'url';

export default defineConfig({
  resolve: {
    // custom resolves for vitest so we don't need to use the main entry point
    alias: [
      { find: /^signalium$/, replacement: fileURLToPath(new URL('./src/index.ts', import.meta.url)) },
      { find: /^signalium\/config$/, replacement: fileURLToPath(new URL('./src/config.ts', import.meta.url)) },
      { find: /^signalium\/utils$/, replacement: fileURLToPath(new URL('./src/utils.ts', import.meta.url)) },
      { find: /^signalium\/debug$/, replacement: fileURLToPath(new URL('./src/debug.ts', import.meta.url)) },
      { find: /^signalium\/react$/, replacement: fileURLToPath(new URL('./src/react/index.ts', import.meta.url)) },
      {
        find: /^signalium\/transform$/,
        replacement: fileURLToPath(new URL('./src/transform/index.ts', import.meta.url)),
      },
    ],
  },
  test: {
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
                    ['reactive', /instrumented-hooks.js$/],
                    ['task', /instrumented-hooks.js$/],
                    ['relay', /instrumented-hooks.js$/],
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
          name: 'unit',
          environment: 'node',
        },
      },
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
                    ['reactive', /instrumented-hooks.js$/],
                    ['task', /instrumented-hooks.js$/],
                    ['relay', /instrumented-hooks.js$/],
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
          include: ['src/transform/__tests__/**/*.test.ts'],
          name: 'transform',
          environment: 'node',
        },
      },
      {
        extends: true,
        plugins: [
          react({
            babel: {
              presets: [
                signaliumPreset({
                  transformedImports: [
                    ['reactive', /instrumented-hooks.js$/],
                    ['task', /instrumented-hooks.js$/],
                    ['relay', /instrumented-hooks.js$/],
                  ],
                }),
              ],
            },
          }),
        ],
        test: {
          include: ['src/react/__tests__/**/*.test.ts(x)'],
          name: 'react',
          browser: {
            enabled: true,
            provider: 'playwright',
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
