# signalium

## 2.0.2

### Patch Changes

- 9248c66: Add setScopeOwner API. This was an oversight from the v2 release, it's necessary
  for reactiveMethod to work correctly on nested context objects. The API is a bit
  clunky, it's likely to change in the future as we refine the context API and add
  some better abstractions for dependency-injection like features.

## 2.0.1

### Patch Changes

- 0c4aa88: Remove unnecessary type overloads for reactive().

  These type overloads were preventing tasks return from Reactives from being
  properly typed.

## 2.0.0

### Major Changes

- f2dce52: Signalium v2 – docs overhaul, async-focused polish, and packaging improvements.

  - New: `notifier()` API for manual invalidation (`consume()`/`notify()`), with tests and docs
  - Docs: comprehensive refresh (consistent capitalization/terminology, fixed local anchors, advanced guides, normalized “side-effect”), new README with quickstart, and prominent `signalium.dev` link
  - Packaging: publish only built artifacts (no `src/`/tests); add legacy CJS shims for `react.js`, `transform.js`, `debug.js`, `utils.js`, and `config.js` via a prepublish script; ensure `exports` map and types for subpaths
  - Misc: refined description/tagline and repo metadata

- 67d9663: Add reactiveMethods
- d471c90: Remove implicit reactive hook consumption, add useReactive
- 4367c00: Adds a universal transform for callbacks and updates the callback API semantics
- 1cb3d49: Update the docs for v2 and add fixes for static Promise methods
- 2a6ba5c: Breaking API changes:

  - `state` -> `signal`
  - `useStateSignal` -> `useSignal`
  - `Subscription` -> `Relay`
  - All `ReactiveX` types are now `XSignal`, reflecting the fact that functions are reactive and values are signals

  See https://github.com/pzuraq/signalium/issues/72 for more details

### Minor Changes

- 3c54d69: Adds `component` API for definining reactive React components

## 1.2.2

### Patch Changes

- b93607d: Make setRootContexts reuse existing scope so we don't leak memory

## 1.2.1

### Patch Changes

- af9216c: Updates runReactiveSafe API to simplify types

## 1.2.0

### Minor Changes

- a56cc6f: Add runReactiveSafe for running reactive functions safely in React apps

## 1.1.1

### Patch Changes

- dd4a7f9: Fix root context inheritance

## 1.1.0

### Minor Changes

- 1a70550: Add setRootContexts
- 0f58c51: Add better GC semantics and manual collection API
- 32fafd4: Add peek and update to StateSignal public API

### Patch Changes

- 1fbd19f: Fix useFrameworkScope integration in React

## 1.0.2

### Patch Changes

- c4cec0a: Fix React render check logic

## 1.0.1

### Patch Changes

- 2d4db91: Bind run functions to promise instances so they can be destructured

## 1.0.0

### Major Changes

- 069c458: Finalize API and release v1

  Breaking changes:

  - `reactive` replaces `computed` and `asyncComputed`
  - Async has been unified around the ReactivePromise interface
  - Simplified the forking behavior of contexts
  - `subscription` now returns a subscription instance, not a factory function
  - `task` now returns a ReactiveTask instance, not a factory function
  - `ContextProvider` receives an array of context/value tuples, rather than a map

## 0.3.8

### Patch Changes

- e1101e6: Fix initialization location in React

## 0.3.7

### Patch Changes

- 4880c2c: Fix React integration with useSyncExternalStore

## 0.3.6

### Patch Changes

- 6248ad2: Fix Signals in tasks

## 0.3.5

### Patch Changes

- 1a28be9: Fix top-level bundling in legacy

## 0.3.4

### Patch Changes

- 5b5d6ea: Expose all types

## 0.3.3

### Patch Changes

- 0d75a20: Export async-task and fix types/refactor internals

## 0.3.2

### Patch Changes

- 17509b6: Add runtime task parameters

## 0.3.1

### Patch Changes

- aaa102b: Fix useContext outside of signals

## 0.3.0

### Minor Changes

- ca2c0f2: Add docs, tests, and deployment. Finalize public API, add some polish.

## 0.2.8

### Patch Changes

- 344b6cb: Add immediate option to watcher

## 0.2.7

### Patch Changes

- 2d6a0b6: Add CommonJS build for legacy interop

## 0.2.6

### Patch Changes

- 1bc41a1: Add config functions to public API

## 0.2.5

### Patch Changes

- 4ee723a: Add main entry to package.json

## 0.2.4

### Patch Changes

- c2af4d0: Refactor scheduling, add batching for React Native

## 0.2.3

### Patch Changes

- 0ba50a0: Remove linked-lists for deps and subs

## 0.2.2

### Patch Changes

- 0376187: Fix a circular ref and add logs to detect circular refs in dev

## 0.2.1

### Patch Changes

- e8aa91a: Fix async init values

## 0.2.0

### Minor Changes

- 4696d06: Refactor await and invalidate to make them more composable

## 0.1.1

### Patch Changes

- 033a814: Add await and invalidate to async signals

## 0.1.0

### Minor Changes

- 03b2d2b: Initial release

### Patch Changes

- a472569: Fix release and build, add linting
