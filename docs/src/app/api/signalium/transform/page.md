---
title: signalium/transform
nextjs:
  metadata:
    title: signalium/transform API
    description: signalium/transform API
---

## Functions

### signaliumPreset

```ts
export function signaliumPreset(opts?: SignaliumTransformOptions): {
  plugins: unknown[];
};
```

Factory for a Babel preset that bundles the Signalium transforms into a single preset. This is the recommended way to use the transforms, and is the only way covered by semver, as implementation details of the plugins might change over time.

The transform targets the following functions:

- `reactive`
- `component`
- `relay`
- `task`
- `reactiveMethod`

And by default, the transform targets the following import sources:

- `signalium`
- `signalium/react`

You can optionally add additional import sources to the transform to target more functions. This allows you to wrap Signalium functions in your own custom functions and still have them transform properly.

```js
import { signaliumPreset } from 'signalium/transform';

module.exports = {
  presets: [
    [
      signaliumPreset,
      {
        transformedImports: [
          // Extend/override import sources for tracked functions
          ['reactive', /^@acme\/signalium$/],
          ['component', '@acme/signalium/react'],
        ],
      },
    ],
  ],
};
```

| Parameter               | Type                           | Description                               |
| ----------------------- | ------------------------------ | ----------------------------------------- |
| opts                    | `SignaliumTransformOptions`    | Options object                            |
| opts.transformedImports | `[string, string \| RegExp][]` | Extend which imports are tracked per name |
