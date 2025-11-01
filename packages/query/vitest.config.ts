/// <reference types="@vitest/browser/providers/playwright" />

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import babel from 'vite-plugin-babel';
import { signaliumPreset } from 'signalium/transform';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
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
        },
      },
    ],
  },
});
