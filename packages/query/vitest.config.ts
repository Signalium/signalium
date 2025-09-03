/// <reference types="@vitest/browser/providers/playwright" />

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import babel from 'vite-plugin-babel';

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        plugins: [],
        test: {
          include: ['src/__tests__/**/*.test.ts'],
          name: 'unit',
          environment: 'node',
        },
      },
      {
        extends: true,
        plugins: [],
        test: {
          include: ['src/transform/__tests__/**/*.test.ts'],
          name: 'transform',
          environment: 'node',
        },
      },
      {
        extends: true,
        plugins: [react()],
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
