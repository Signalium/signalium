#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const pkgRoot = path.resolve(__dirname, '..');

function write(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('wrote', path.relative(pkgRoot, filePath));
}

// Generate CJS wrappers using re-export pattern for all subpaths
function makeReexportWrapper(requirePath) {
  return [
    "'use strict';",
    "Object.defineProperty(exports, '__esModule', {",
    '  value: true,',
    '});',
    `var _index = require('${requirePath}');`,
    'Object.keys(_index).forEach(function (key) {',
    "  if (key === 'default' || key === '__esModule') return;",
    '  if (key in exports && exports[key] === _index[key]) return;',
    '  Object.defineProperty(exports, key, {',
    '    enumerable: true,',
    '    get: function () {',
    '      return _index[key];',
    '    },',
    '  });',
    '});',
    '',
  ].join('\n');
}

// Generate .d.ts wrappers that re-export types from ESM declarations
function makeTypeReexportWrapper(importPath) {
  return [`export * from '${importPath}';`, ''].join('\n');
}

// Create stores directory in package root
const storesDir = path.join(pkgRoot, 'stores');
if (!fs.existsSync(storesDir)) {
  fs.mkdirSync(storesDir, { recursive: true });
}

// Generate store entries
write(path.join(storesDir, 'async.js'), makeReexportWrapper('../dist/cjs/stores/async.js'));
write(path.join(storesDir, 'sync.js'), makeReexportWrapper('../dist/cjs/stores/sync.js'));

// Write package.json to CJS directory to mark it as CommonJS
write(path.join(pkgRoot, 'dist/cjs/package.json'), JSON.stringify({ type: 'commonjs' }, null, 2) + '\n');

// Type re-export wrappers for legacy entry points
write(path.join(pkgRoot, 'index.d.ts'), makeTypeReexportWrapper('./dist/esm/index.js'));
write(path.join(storesDir, 'async.d.ts'), makeTypeReexportWrapper('../dist/esm/stores/async.js'));
write(path.join(storesDir, 'sync.d.ts'), makeTypeReexportWrapper('../dist/esm/stores/sync.js'));

console.log('Legacy entries generated.');
