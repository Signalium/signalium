/// <reference types="@vitest/browser/providers/playwright" />

import { defineConfig } from 'vitest/config';
import babel from 'vite-plugin-babel';
import { signaliumPreset } from 'signalium/transform';

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
              presets: [signaliumPreset()],
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
    ],
  },
});
