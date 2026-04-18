import { defineConfig } from 'vite';
import { resolve } from 'path';
import react from '@vitejs/plugin-react';

const isProduction = process.env.BUILD_MODE === 'production';
const outputSubdir = isProduction ? 'production' : 'development';

const srcDir = resolve(__dirname, '.tsc-out');

export default defineConfig({
  plugins: [react()],
  define: {
    IS_DEV: JSON.stringify(!isProduction),
    IS_LOCAL_DEV: 'false',
  },
  build: {
    lib: {
      entry: {
        index: resolve(srcDir, 'index.js'),
        config: resolve(srcDir, 'config.js'),
        utils: resolve(srcDir, 'utils.js'),
        debug: resolve(srcDir, 'debug.js'),
        'react/index': resolve(srcDir, 'react/index.js'),
        'react/index.server': resolve(srcDir, 'react/index.server.js'),
        'react/server': resolve(srcDir, 'react/server.js'),
        'transform/index': resolve(srcDir, 'transform/index.js'),
      },
      formats: ['es', 'cjs'],
    },
    outDir: 'dist',
    minify: false,
    sourcemap: true,
    emptyOutDir: false,
    rollupOptions: {
      external: ['react', 'react/jsx-runtime', '@babel/core', '@babel/helper-plugin-utils', /^@babel\//],
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
