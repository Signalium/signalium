import { defineConfig } from 'vite';
import { resolve } from 'path';
import react from '@vitejs/plugin-react';

const isProduction = process.env.BUILD_MODE === 'production';
const outputSubdir = isProduction ? 'production' : 'development';

export default defineConfig({
  plugins: [react()],
  define: {
    IS_DEV: JSON.stringify(!isProduction),
  },
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        'react/index': resolve(__dirname, 'src/react/index.ts'),
        'stores/async': resolve(__dirname, 'src/stores/async.ts'),
        'stores/sync': resolve(__dirname, 'src/stores/sync.ts'),
      },
      formats: ['es', 'cjs'],
    },
    outDir: 'dist',
    minify: false,
    sourcemap: true,
    emptyOutDir: false,
    rollupOptions: {
      external: ['react', 'react/jsx-runtime', 'signalium', 'signalium/react', 'signalium/utils', /^signalium\//],
      output: [
        {
          format: 'es',
          dir: `dist/esm/${outputSubdir}`,
          entryFileNames: '[name].js',
          chunkFileNames: '[name]-[hash].js',
        },
        {
          format: 'cjs',
          dir: `dist/cjs/${outputSubdir}`,
          entryFileNames: '[name].js',
          chunkFileNames: '[name]-[hash].js',
          exports: 'named',
        },
      ],
    },
  },
});
