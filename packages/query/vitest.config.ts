/// <reference types="@vitest/browser/providers/playwright" />

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import babel from 'vite-plugin-babel';
import { signaliumPreset } from './src/transform/index.js';

export default defineConfig({
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
