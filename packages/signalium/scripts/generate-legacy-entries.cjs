#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const pkgRoot = path.resolve(__dirname, '..');

function write(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('wrote', path.relative(pkgRoot, filePath));
}

// Generate CJS wrappers using re-export pattern for all subpaths
// These point to production builds by default
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

// Generate for all entries consistently - pointing to production builds
write(path.join(pkgRoot, 'react.js'), makeReexportWrapper('./dist/cjs/production/react/index.js'));
write(path.join(pkgRoot, 'transform.js'), makeReexportWrapper('./dist/cjs/production/transform/index.js'));
write(path.join(pkgRoot, 'debug.js'), makeReexportWrapper('./dist/cjs/production/debug.js'));
write(path.join(pkgRoot, 'utils.js'), makeReexportWrapper('./dist/cjs/production/utils.js'));
write(path.join(pkgRoot, 'config.js'), makeReexportWrapper('./dist/cjs/production/config.js'));

// Write package.json to CJS directories to mark them as CommonJS
const cjsPackageJson = JSON.stringify({ type: 'commonjs' }, null, 2) + '\n';
write(path.join(pkgRoot, 'dist/cjs/production/package.json'), cjsPackageJson);
write(path.join(pkgRoot, 'dist/cjs/development/package.json'), cjsPackageJson);

// Type re-export wrappers for legacy entry points (shared types in dist/esm)
write(path.join(pkgRoot, 'index.d.ts'), makeTypeReexportWrapper('./dist/esm/index.js'));
write(path.join(pkgRoot, 'react.d.ts'), makeTypeReexportWrapper('./dist/esm/react/index.js'));
write(path.join(pkgRoot, 'transform.d.ts'), makeTypeReexportWrapper('./dist/esm/transform/index.js'));
write(path.join(pkgRoot, 'debug.d.ts'), makeTypeReexportWrapper('./dist/esm/debug.js'));
write(path.join(pkgRoot, 'utils.d.ts'), makeTypeReexportWrapper('./dist/esm/utils.js'));
write(path.join(pkgRoot, 'config.d.ts'), makeTypeReexportWrapper('./dist/esm/config.js'));

console.log('Legacy entries generated.');
