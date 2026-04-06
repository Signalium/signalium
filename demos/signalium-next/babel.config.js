const { signaliumPreset } = require('signalium/transform');

/** @type {import('@babel/core').TransformOptions} */
module.exports = {
  presets: ['next/babel', [signaliumPreset, {}]],
};
