import withMarkdoc from '@markdoc/next.js';

import withSearch from './src/markdoc/search.mjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  reactStrictMode: false,
  pageExtensions: ['js', 'jsx', 'md', 'ts', 'tsx'],
  webpack(config) {
    config.resolve.extensionAlias = {
      '.js': ['.js', '.ts', '.jsx', '.tsx'],
      '.jsx': ['.jsx', '.tsx', '.js', '.ts'],
    };
    // Use development builds of signalium to enable tracing in docs
    config.resolve.conditionNames = [
      'development',
      'browser',
      'module',
      'import',
      'default',
    ];
    return config;
  },
};

export default withSearch(
  withMarkdoc({ schemaPath: './src/markdoc', mode: 'static' })(nextConfig),
);
