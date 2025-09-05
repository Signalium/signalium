import { signaliumAsyncTransform } from './async.js';
import { signaliumCallbackTransform } from './callback.js';
import { signaliumPromiseMethodsTransform } from './promise.js';

export interface SignaliumTransformOptions {
  transformedImports?: [string, string | RegExp][];
}

// Babel preset that sequences the two plugins just like separate entries
// Usage in babel config: presets: [[require('signalium/transform').signaliumPreset(options)]
export function signaliumPreset(opts?: SignaliumTransformOptions) {
  return {
    plugins: [
      signaliumCallbackTransform({ transformedImports: opts?.transformedImports ?? [] }),
      signaliumAsyncTransform({ transformedImports: opts?.transformedImports ?? [] }),
      // Transform Promise.* calls inside signalium functions to ReactivePromise.*
      // Must run after async so that await->yield conversion has already occurred
      signaliumPromiseMethodsTransform({ transformedImports: opts?.transformedImports ?? [] }),
    ],
  };
}
