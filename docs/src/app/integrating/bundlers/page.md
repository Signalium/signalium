---
title: Bundler setup
---

The Signalium Babel preset (`signaliumPreset` from `signalium/transform`) is **optional**. Without it, you can still use:

- `signal`, `reactive`, `relay`, `context`, `task`, `watcher`, `notifier`, `reactiveMethod`, `getContext`, `withContexts` from `signalium`.
- `component(() => ...)` (sync), `useSignal`, `useReactive`, `useContext`, `ContextProvider`, `PauseSignalsProvider` from `signalium/react`.
- Reactive promises via `reactive(() => somePromise)` and explicit `isPending`/`isReady` checks.

You need the preset when you want to write:

- `component(async (props) => { await ... })` — async components that await reactive promises and integrate with Suspense.
- `reactive(async () => { await ... })` — async reactive functions that preserve dependency tracking across `await` points.
- Inline thunks that should be `useCallback`-stabilized automatically (the preset hoists thunks passed to `useReactive` and similar).

This page covers how to enable the preset in every common bundler.

{% callout title="Preset ordering" %}
The Signalium preset transforms source that may already be JSX/TS/async. Add it **last** in the `presets` array so other presets (e.g. `@babel/preset-env`, `@babel/preset-react`, `@babel/preset-typescript`) run first in Babel's reverse-order convention.
{% /callout %}

## Vite

Vite uses `@vitejs/plugin-react` (or `@vitejs/plugin-react-swc`). For Babel integration, use the non-SWC variant:

```js
// vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { signaliumPreset } from 'signalium/transform';

export default defineConfig({
  plugins: [
    react({
      babel: {
        presets: [signaliumPreset()],
      },
    }),
  ],
});
```

If you're on `@vitejs/plugin-react-swc` and don't want to switch to the Babel-backed plugin, you can still use synchronous `component(...)` and `useReactive` — just avoid async components until you add the Babel plugin.

## Next.js (App Router)

Next.js supports Babel plugins via a project-level `babel.config.js` (or `.babelrc`). Adding one opts you out of SWC compilation for that project, which has performance implications — but it's the supported path for custom Babel presets:

```js
// babel.config.js
const { signaliumPreset } = require('signalium/transform');

module.exports = {
  presets: ['next/babel', signaliumPreset()],
};
```

That preset stack should be all you need — `next/babel` handles JSX, TypeScript, and the React-specific transforms Next.js expects.

### Next.js with the React Compiler

Next.js has experimental support for the React Compiler. The Signalium preset composes with it — `component(...)` wraps a function that the React Compiler can optimize, and the Signalium transforms are independent of the compiler's memoization pass:

```js
// babel.config.js
const { signaliumPreset } = require('signalium/transform');

module.exports = {
  presets: [
    ['next/babel', { 'preset-react': { runtime: 'automatic' } }],
    signaliumPreset(),
  ],
  plugins: [
    ['babel-plugin-react-compiler', { /* compiler options */ }],
  ],
};
```

Plugins run before presets in Babel's ordering, so the React Compiler runs first, then the Signalium preset wraps whatever the compiler produced. In practice both output functions still compose correctly because Signalium's transforms only care about calls to `reactive`/`component`/`useReactive` — which the compiler leaves alone.

### Next.js without the preset

If you'd rather keep Next.js on SWC, you can skip the preset and use the non-async surfaces. Everything synchronous works out of the box; for async, use `use(somePromise)` from React instead of `await` inside `component(...)`:

```tsx
import { use } from 'react';
import { component } from 'signalium/react';
import { loadUser } from '@/lib/data';

export const UserCard = component(({ id }: { id: string }) => {
  const user = use(loadUser(id));
  return <p>{user.name}</p>;
});
```

See [RSC & SSR](/integrating/rsc-ssr) for more on server vs. client code paths.

## Create React App / CRACO

CRA is frozen upstream, but CRACO is still a viable path to extend its Babel config:

```js
// craco.config.js
const { signaliumPreset } = require('signalium/transform');

module.exports = {
  babel: {
    presets: [signaliumPreset()],
  },
};
```

Make sure `package.json` scripts use `craco start` / `craco build` instead of `react-scripts`.

If you prefer not to use CRACO, eject or switch to Vite — both are less work than maintaining a patched CRA long-term.

## Plain Webpack (via `babel-loader`)

```js
// webpack.config.js
const { signaliumPreset } = require('signalium/transform');

module.exports = {
  module: {
    rules: [
      {
        test: /\.(js|jsx|ts|tsx)$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              ['@babel/preset-env', { targets: 'defaults' }],
              '@babel/preset-react',
              '@babel/preset-typescript',
              signaliumPreset(),
            ],
          },
        },
      },
    ],
  },
};
```

Or keep the Babel config in `babel.config.js` and let `babel-loader` pick it up automatically:

```js
// babel.config.js
const { signaliumPreset } = require('signalium/transform');

module.exports = {
  presets: [
    ['@babel/preset-env', { targets: 'defaults' }],
    '@babel/preset-react',
    '@babel/preset-typescript',
    signaliumPreset(),
  ],
};
```

```js
// webpack.config.js
module.exports = {
  module: {
    rules: [{ test: /\.(jsx?|tsx?)$/, exclude: /node_modules/, use: 'babel-loader' }],
  },
};
```

## esbuild (via `esbuild-plugin-babel` / `@babel/core` runner)

esbuild doesn't run Babel natively, but you can bridge via `esbuild-plugin-babel` or a custom plugin that calls `@babel/core`:

```js
// esbuild.config.js
import { build } from 'esbuild';
import babel from 'esbuild-plugin-babel';
import { signaliumPreset } from 'signalium/transform';

build({
  entryPoints: ['src/index.tsx'],
  outfile: 'dist/bundle.js',
  bundle: true,
  plugins: [
    babel({
      filter: /\.(js|jsx|ts|tsx)$/,
      config: {
        presets: [
          '@babel/preset-env',
          '@babel/preset-react',
          '@babel/preset-typescript',
          signaliumPreset(),
        ],
      },
    }),
  ],
});
```

If you're using esbuild as part of a larger toolchain (Vite, tsup, etc.), consult that tool's Babel integration — direct esbuild users are the exception. Running Babel over every file negates esbuild's speed advantage; prefer a Babel-backed bundler or SWC with the Signalium preset skipped.

## Metro (React Native)

Metro uses Babel by default, so the preset just plugs in:

```js
// babel.config.js
const { signaliumPreset } = require('signalium/transform');

module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      'babel-preset-expo', // or 'module:metro-react-native-babel-preset'
      signaliumPreset(),
    ],
  };
};
```

Clear the cache after adding the preset:

```bash
npx expo start --clear
# or
npx react-native start --reset-cache
```

See [React Native](/integrating/react-native) for the full RN integration guide.

## Rspack

Rspack supports Babel via `builtin:swc-loader` + a separate Babel pass, or directly via `babel-loader`. The simplest path mirrors the Webpack config:

```js
// rspack.config.js
const { signaliumPreset } = require('signalium/transform');

module.exports = {
  module: {
    rules: [
      {
        test: /\.(jsx?|tsx?)$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'babel-loader',
            options: {
              presets: [
                '@babel/preset-env',
                '@babel/preset-react',
                '@babel/preset-typescript',
                signaliumPreset(),
              ],
            },
          },
        ],
      },
    ],
  },
};
```

## Parcel

Parcel picks up `babel.config.js` automatically:

```js
// babel.config.js
const { signaliumPreset } = require('signalium/transform');

module.exports = {
  presets: [signaliumPreset()],
};
```

Parcel applies its own default transforms (JSX, TypeScript, module conversion) before Babel runs your custom presets.

## Rollup

Rollup integrates with Babel through `@rollup/plugin-babel`:

```js
// rollup.config.js
import { babel } from '@rollup/plugin-babel';
import { signaliumPreset } from 'signalium/transform';

export default {
  input: 'src/index.tsx',
  output: { file: 'dist/bundle.js', format: 'esm' },
  plugins: [
    babel({
      extensions: ['.js', '.jsx', '.ts', '.tsx'],
      babelHelpers: 'bundled',
      presets: [
        '@babel/preset-env',
        '@babel/preset-react',
        '@babel/preset-typescript',
        signaliumPreset(),
      ],
    }),
  ],
};
```

## Jest / Vitest

Test runners need the preset too if your tests exercise async components or rely on the thunk-stabilization behavior.

### Jest with `babel-jest`

```js
// babel.config.js (or a test-specific override)
const { signaliumPreset } = require('signalium/transform');

module.exports = {
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' } }],
    '@babel/preset-react',
    '@babel/preset-typescript',
    signaliumPreset(),
  ],
};
```

Jest auto-discovers `babel.config.js` through `babel-jest`.

### Vitest

Vitest runs Vite's transform pipeline, so whatever you configured in `vite.config.ts` applies. If you don't have a dedicated `vitest.config.ts`, the standard Vite config's Babel preset is used for tests too.

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { signaliumPreset } from 'signalium/transform';

export default defineConfig({
  plugins: [
    react({
      babel: { presets: [signaliumPreset()] },
    }),
  ],
  test: {
    environment: 'jsdom',
  },
});
```

## Preset options

`signaliumPreset()` takes an options object:

```js
signaliumPreset({
  transformAsyncComponents: true,     // default true — enables component(async ...)
  transformAsyncReactives: true,      // default true — enables reactive(async ...)
  stabilizeThunks: true,              // default true — wraps useReactive thunks in useCallback
});
```

If you want a minimal transform (for example, only enabling async `reactive` in a server-side bundle), disable the ones you don't need. Most apps use the defaults.

See the [`signalium/transform` API reference](/api/signalium/transform) for the full option list.

## Checking the preset is active

A quick sanity check: try defining an async component without the preset:

```tsx
import { component } from 'signalium/react';

const Broken = component(async () => {
  await Promise.resolve();
  return <p>Hello</p>;
});
```

Without the preset, Signalium throws at definition time with:

```
signalium: `component(async (props) => { await ... })` requires the Signalium Babel preset (async transform).
```

If that error fires, the preset isn't running. Re-check your Babel config and clear any bundler cache (`vite --force`, `expo start --clear`, etc.).

If the component renders, the preset is working.

## When you don't need the preset

You can ship Signalium in production without ever enabling the preset. The trade-offs:

| Feature | Without preset | With preset |
|---|---|---|
| `signal`, sync `reactive`, `relay`, `watcher`, etc. | Works | Works |
| Sync `component(() => ...)` | Works | Works |
| `useSignal`, `useReactive`, `useContext` | Works | Works |
| `component(async () => { await ... })` | Not supported | Works |
| `reactive(async () => { await ... })` | Works; manual promise chains required | Works with `await` |
| `useReactive(() => fn())` auto-stabilized thunks | Thunks re-allocate each render | Thunks hoisted to `useCallback` automatically |

For an app that uses only synchronous reactive code and handles async via explicit promise chains, skipping the preset is a reasonable choice — fewer moving parts, easier debugging. Add it when the lack of `await` starts to hurt.

## Next steps

- [Installation & setup](/setup/install) — first-time install instructions.
- [React Native](/integrating/react-native) — Metro-specific notes.
- [RSC & SSR](/integrating/rsc-ssr) — server-side rendering caveats.
- [Code transforms & async context](/guides/code-transforms) — what the preset actually does.
- [API: signalium/transform](/api/signalium/transform) — full preset options reference.
