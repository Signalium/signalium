import { signaliumAsyncTransform } from './async.js';
import { signaliumCallbackTransform } from './callback.js';
import { signaliumPromiseMethodsTransform } from './promise.js';
import { isBabelApi } from './utils.js';

export interface SignaliumTransformOptions {
  transformedImports?: [string, string | RegExp][];
  importPaths?: (string | RegExp)[];
  callbackImportPath?: string;
  promiseImportPath?: string;
}

// Babel preset that sequences the two plugins just like separate entries
// Usage in babel config: presets: [[require('signalium/transform').signaliumPreset(options)]
function createSignaliumPreset(api: any, opts?: SignaliumTransformOptions) {
  return {
    plugins: [
      signaliumCallbackTransform({
        transformedImports: opts?.transformedImports ?? [],
        importPaths: opts?.importPaths,
        callbackImportPath: opts?.callbackImportPath,
      }),
      signaliumAsyncTransform({ transformedImports: opts?.transformedImports ?? [], importPaths: opts?.importPaths }),
      signaliumPromiseMethodsTransform({
        transformedImports: opts?.transformedImports ?? [],
        importPaths: opts?.importPaths,
        promiseImportPath: opts?.promiseImportPath,
      }),
    ],
  };
}

export function signaliumPreset(api: any, opts?: SignaliumTransformOptions): any;
export function signaliumPreset(opts?: SignaliumTransformOptions): (api: any) => any;
export function signaliumPreset(
  apiOrOpts?: any | SignaliumTransformOptions,
  maybeOpts?: SignaliumTransformOptions,
): ((api: any) => any) | any {
  if (isBabelApi(apiOrOpts)) {
    return createSignaliumPreset(apiOrOpts as any, maybeOpts);
  }
  return (api: any) => createSignaliumPreset(api, apiOrOpts as SignaliumTransformOptions | undefined);
}
