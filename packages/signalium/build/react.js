// This file is for backwards compatibility with non-module build systems
//
// TODO: Generate this automatically on build/publish

'use strict';
Object.defineProperty(exports, '__esModule', {
  value: true,
});
var _index = require('./dist/cjs/react/index.js');
Object.keys(_index).forEach(function (key) {
  if (key === 'default' || key === '__esModule') return;
  if (key in exports && exports[key] === _index[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _index[key];
    },
  });
});
