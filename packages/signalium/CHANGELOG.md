# signalium

## 3.0.0

### Major Changes

- 97a1d00: Add async component support with Suspense + RSC/SSR integration.

  - `component(async (props) => { await ... })` on the client: the Signalium Babel preset
    rewrites the async body to a generator, and a synchronous replay driver throws pending
    thenables for `<Suspense>` while re-injecting settled values on replay. Reactive reads
    inside the component participate in the signal graph like any other `compute`.
  - New `signalium/react` `react-server` export condition: in RSC bundles, `component()`
    returns a real `async function` (for generator authoring) or a thin sync wrapper, with
    no React hook imports — safe for the server module graph.
  - New `signalium/react/server` entry exposing `setupRscRequestScope()`, which installs a
    per-request `SignalScope` via `React.cache` so server-side `reactive()` / `task()` /
    `relay()` don't leak across requests.
  - New core API `setRequestScopeGetter(get)` that frameworks/tests can use to supply a
    per-request scope; consulted by `getCurrentScope` after `CURRENT_SCOPE` and the current
    consumer's scope.
  - Babel async transform now tracks `component` imported from `signalium/react` alongside
    `reactive` / `reactiveMethod` / `relay` / `task`, so `component(async ...)` is rewritten
    to a generator without extra configuration.

  Breaking: `react` peer dependency is now `>=19.0.0` (required for `React.cache` and
  React 19's thenable handling in `<Suspense>`).

- 9fa0d88: `ReactivePromise<T>` is now the discriminated union by default.

  The exported `ReactivePromise<T>` _type_ is now
  `PendingReactivePromise<T> | ReadyReactivePromise<T>` — the same shape that was
  previously named `DiscriminatedReactivePromise<T>`. This means `if (p.isReady)`
  narrows `p.value` to `T` (no `| undefined`) directly, with no extra type
  gymnastics.

  The exported `ReactivePromise` _value_ (the class for `instanceof`, `new`, and
  the static methods `all` / `race` / `any` / `allSettled` / `resolve` / `reject`
  / `withResolvers`, plus the identifier emitted by the Babel preset's promise
  methods transform) is unchanged at runtime. It's now typed as a constructor
  interface (the same pattern lib.es5.d.ts uses for the global `Promise`), so:

  - `new ReactivePromise<T>()` returns `ReactivePromise<T>` (the union)
  - `value instanceof ReactivePromise` narrows to the union
  - `ReactivePromise.resolve(x)`, `.all([...])`, etc. return the union

  ### Breaking changes

  - `DiscriminatedReactivePromise<T>` is removed. Replace every reference with
    `ReactivePromise<T>`. The two types are now identical, so the migration is a
    rename.
  - The previous wide `ReactivePromise<T>` interface (with `value: T | undefined`
    and `isReady: boolean`) is no longer exported. If you had code that explicitly
    asked for that wide shape, switch to discriminating on `isReady` (or accept
    `PendingReactivePromise<T>` / `ReadyReactivePromise<T>` directly).

  ### Why

  The previous split between a non-discriminated `ReactivePromise<T>` (the class
  instance type) and a separate `DiscriminatedReactivePromise<T>` union (what
  `useReactive`, `relay()`, async `reactive()`, etc. actually returned) was a
  frequent source of confusion. The names suggested they were different shapes
  when in practice users almost always wanted the discriminated form. Merging
  them removes a footgun and matches the runtime behavior.

- 46facb0: `useReactive` is now thunk-only and deep-by-default.

  ### New API surface

  - `useReactive(() => expr)` — deep-by-default. Returns a structurally-shared
    snapshot of the reactive value, so referential equality at the React boundary
    Just Works (memoized children keep the same props when unchanged subtrees are
    re-read). This is the behavior of the old `useReactiveDeep`.
  - `useReactiveShallow(() => expr)` — new named export. Minimal wrapper:
    returns the reactive value by reference without any structural cloning or
    `ReactivePromise` entanglement. Re-renders only when the underlying
    `ReactiveSignal` itself re-runs (e.g. the thunk produces a new reference).
    Use it when you need to preserve class identity on a synchronously-changing
    value. If you need promise state transitions at the React boundary, use
    `useReactive` — its structural snapshot reads the promise's flags and
    automatically re-renders on each transition.
  - `useReactiveDeep(() => expr)` — kept as a deprecated alias that forwards to
    `useReactive` and logs a one-time `console.warn` in dev. Will be removed in
    the next major.

  ### Breaking changes

  - The non-thunk overloads are removed:
    - `useReactive(signal)` → `useReactive(() => signal.value)`
    - `useReactive(promise)` → `useReactive(() => promise)` for a plain
      snapshot that updates on every promise state transition.
    - `useReactive(reactiveFn, arg1, arg2)` → `useReactive(() => reactiveFn(arg1, arg2))`
    - `useReactiveDeep(reactiveFn, arg1)` → `useReactive(() => reactiveFn(arg1))`
  - Calling `useReactive` / `useReactiveShallow` / `useReactiveDeep` inside a
    reactive function (e.g. inside `reactive(...)` or a `component()` render
    body) now throws in dev (the guard is tree-shaken from production builds).
    These hooks are the bridge from plain React components into the signal
    graph — inside reactive code you should call your signals and
    `reactive()`-returned functions directly, since the surrounding compute
    already participates in the graph. This replaces the previous behavior of
    silently forking and invoking the thunk.
  - The internal `addListener` on `ReactiveSignal` no longer schedules an
    initial pull when the signal is registered as a suspended listener. This
    fixes a case where a component mounted inside a suspended provider would
    render twice on mount.

  ### Recommended migration

  1. Land this version and enable (or keep) the Signalium Babel preset. The
     preset wraps thunks in `useCallback(fn, [captures])` so identity stays
     stable across renders and the same `ReactiveSignal` is reused.
  2. Rewrite `useReactive(signal)` / `useReactive(fn, ...args)` call sites as
     thunks. A safe blanket replacement is `useReactive(() => oldArg)` /
     `useReactive(() => oldFn(...oldArgs))`.
  3. If you were relying on `ReactivePromise` class identity (e.g. `instanceof`
     checks or passing through `React.memo` by reference), switch those sites to
     `useReactiveShallow`.
  4. Rename `useReactiveDeep` call sites to `useReactive` at your leisure — they
     behave identically but the old name will be removed in the next major.

  ### Philosophy

  `useReactive` is the bridge from plain React components into the signal graph.
  Every call site is a hook, so there's per-render bookkeeping overhead. Prefer
  `component(fn)` (from `signalium/react`) for components that are meaningfully
  reactive — the whole render body becomes one `ReactiveSignal`'s `compute`,
  which avoids the hook overhead entirely.

- 5031ce1: Switch to native `WeakRef` for scope-cached signals, remove suspension from the core graph, and introduce `PauseSignalsProvider`.

  ### Native WeakRef GC

  `SignalScope` now stores signals as `WeakRef` entries instead of strong references with manual GC sweeps. Signals stay alive as long as something holds a strong reference (the `deps` chain, a React component closure, a local variable, etc.). When nothing references a signal, the JS garbage collector reclaims it naturally.

  Removed:

  - The `WeakRef` polyfill (`weakref.ts`) — environments without native `WeakRef` are no longer supported.
  - The manual GC sweep system (`markForGc`, `removeFromGc`, `sweepGc`, `gcCandidates`, `scheduleGcSweep`, `scheduleIdleCallback`).
  - `reset()` on `ReactiveSignal` — signals are no longer eagerly torn down on unwatch. Their value and dep graph are preserved for reuse if re-watched before GC collects them.

  ### Suspension removed from core

  The core signal graph has zero suspension concepts. Removed:

  - `suspendCount` field and `_isSuspended` getter on `ReactiveSignal`
  - `setSuspended()` method and `isSuspendedListener` flag
  - `watchSuspendedSignal`, `unwatchSuspendedSignal`, `suspendSignal`, `resumeSignal`
  - The `parentIsSuspended` parameter on `watchSignal` / `unwatchSignal`
  - The `isSuspending` branch in `deactivateSignal`

  ### `PauseSignalsProvider` (replaces `SuspendSignalsProvider`)

  `SuspendSignalsProvider` is replaced by `PauseSignalsProvider` to avoid confusion with React Suspense.

  `PauseSignalsProvider` uses a stable `PauseSignalsManager` context (not a changing boolean), so toggling the `value` prop does not re-render descendants. React hooks register their signals during render; the manager calls `watchSignal` / `unwatchSignal` directly to pause and resume the signal graph. Signals mounted inside an already-paused provider skip activation entirely.

  ### Breaking changes

  - `SuspendSignalsProvider` → `PauseSignalsProvider`
  - `useSignalsSuspended()` is removed from the public API.
  - `setSuspended()` is removed from the `Watcher` interface.
  - Environments without native `WeakRef` are no longer supported.

### Minor Changes

- 500514d: Remove the implicit `console.error('[signalium] Unhandled async error...')`
  that fired whenever a `ReactivePromise` (including `relay()` and `task()`)
  transitioned to a rejected state.

  The log was misleading in practice: it ran synchronously inside `_setError`,
  before any reactive consumer or async `component()` had a chance to react. So
  it printed "Unhandled" for rejections that were in fact handled — declaratively
  via `isRejected` / `error` reads, by `await` in an async `component()` (which
  re-throws into a React error boundary), or by an explicit `.catch()` on the
  `ReactivePromise` surface. There's no general definition of "handled" in a
  reactive graph, so any single heuristic was going to mislabel some path.

  Rejected `ReactivePromise`s are now silent at the library layer. Existing
  ways to observe a rejection are unchanged:

  - Read `isRejected` / `error` on the `ReactivePromise` (or its
    `useReactive` snapshot) and branch in your reactive code.
  - `await` / `yield` the `ReactivePromise` from an async `component()`; the
    replay driver throws `error` into the nearest React error boundary on
    rejection (and throws a thenable for `<Suspense>` while pending).
  - `.catch()` / `.then(null, fn)` on the `ReactivePromise` — it still
    implements the `Promise` surface.

  A first-class global hook for unhandled reactive rejections is intentionally
  deferred: defining "handled" in a way that doesn't mislabel the cases above
  needs more design and isn't required for v3.

  If you were relying on the log for debugging, attach your own logging in a
  declarative branch (e.g. inside a `reactive()` that reads `isRejected` /
  `error`) or rethrow from an async `component()` so the error reaches a React
  error boundary.

## 2.4.0

### Minor Changes

- b080603: Add thunk form to `useReactive` and `useReactiveDeep` with Babel auto-memoization.

  - `useReactive(() => expr)` / `useReactiveDeep(() => expr)` now accept an
    inline zero-arg function. The existing scope-cached path handles this: the
    `ReactiveDefinition` is memoized by fn identity in a `WeakMap`, so a
    memoized thunk (via `useCallback` or the Babel preset) reuses the same
    signal across renders.
  - Function forms now return `ReactiveValue<R>`, so `useReactive(async () => ...)`
    is typed as `DiscriminatedReactivePromise<U>` and async result fields
    (`isPending`, `value`, `isReady`, etc.) work without casts.
  - New Babel transform `signaliumUseReactiveTransform` (wired into
    `signaliumPreset`) wraps the thunk in `useCallback(fn, [captures])`,
    collecting captured identifiers the same way the callback transform does.
    This gives thunks a stable identity when captures are equal, even when
    written inline in a component body.
  - Async thunks (`useReactive(async () => { await ... })`) are supported via
    the existing async→generator transform, which now also tracks `useReactive`
    and `useReactiveDeep` imported from `signalium/react`.
  - Without the Babel preset, the thunk path still works correctly — it simply
    allocates a fresh definition and signal on every render.

  Back-compat: the existing overloads (`useReactive(signal)`,
  `useReactive(promise)`, `useReactive(reactiveFn, ...args)`,
  `useReactiveDeep(reactiveFn, ...args)`) continue to work unchanged. No
  migration is required; teams can incrementally adopt the thunk form.

  Bonus: the callback transform no longer adds an unused
  `import { callback } from 'signalium'` when a tracked call has no nested
  callbacks to wrap, and it no longer tries to augment `import type`
  declarations.

## 2.3.2

### Patch Changes

- cbfa131: Handle AbortError values safely when DOMException is unavailable.

## 2.3.1

### Patch Changes

- c92035c: Initial pre-release of Fetchium

## 2.3.0

### Minor Changes

- 90f9b8b: Add useReactiveDeep

### Patch Changes

- 01714fe: Fix some small issues with the build, add some tests

## 2.2.3

### Patch Changes

- 6c19cdc: Add `skipInitial` option to `watcher.addListener()` to skip the notification fired on initial activation

  Fix: Reset `listeners.updatedAt` when all listeners are removed, so re-subscribing correctly fires the initial notification. Previously, stale `updatedAt` state could cause missed notifications after unsubscribing and re-subscribing.

## 2.2.2

### Patch Changes

- 0aedc29: Fix bugs with async reactive functions never resolving
- 5f0aafc: Add better tests for the hash function, fix some minor edge cases

## 2.2.1

### Patch Changes

- 5378406: Fix async and add chaos tests

## 2.2.0

### Minor Changes

- 0b6b650: Add setSuspended API for more explicit suspension support

## 2.1.7

### Patch Changes

- 82a87ba: Prevent inifinite loop due to double dirtying/pending
- 2230c74: React ContextProvider: store SignalScope in a ref so the same scope instance is reused across re-renders instead of being recreated each time, avoiding orphaned signals and unnecessary memory usage.

## 2.1.6

### Patch Changes

- f07ed0e: Add separate dev-mode and prod-mode builds

## 2.1.5

### Patch Changes

- 985abb0: Fix reused identifier node in Babel transforms

## 2.1.4

### Patch Changes

- 2cf6766: Add forwardRelay utility

## 2.1.3

### Patch Changes

- cf80e05: Fix unchanged promises losing dependencies

  This fix ensures that promises that haven't changed maintain their dependency edges in the `_awaitSubs` map, preventing dangling references and ensuring correct reactive computation order.

  **Changes:**

  - Updated `checkSignal()` to preserve dependency edges for unchanged promises by adding them to the promise's `_awaitSubs` map
  - Modified `disconnectSignal()` to accept `computedCount` parameter for proper dependency tracking
  - Added documentation explaining promise edge tracking in `_setPending()`
  - Removed obsolete `PROMISE_WAS_RESOLVED` flag mechanism from scheduling system

## 2.1.2

### Patch Changes

- 7350348: Ensure async reactive cleanup happens after promises settle
- c78b461: Adds reactiveSignal for directly creating individual reactive signals

## 2.1.1

### Patch Changes

- 00ae954: Signalium:

  - Add support for Sets, Maps, and Dates in the `hashValue` function
    - Note: This may cause some _minor_ differences in reactive functions that receive these types as parameters, they should essentially run less often in those cases. The impact of this should be minimal, so we're not considering it a breaking change.

  Query:

  - Add shape checking to make sure that if the shape of a query is changed, the query key will change as well, preventing stale data with a different shape from being returned from the query store
  - Fix an issue where shrinking the `maxCount` of a query would cause an error when trying to activate the query

## 2.1.0

### Minor Changes

- e64597d: Add ability to suspend signal subtrees in React

### Patch Changes

- 4c35e93: Add Stream Query support

## 2.0.9

### Patch Changes

- 6eddfdc: Fixed an issue where reactive promises were overly eager and scheduling even
  when they were not watched.

## 2.0.8

### Patch Changes

- 55ab462: Fixed an issue with async promise update propagation

## 2.0.7

### Patch Changes

- e6c39ee: Initial Signalium Query release

## 2.0.6

### Patch Changes

- 0c6d407: Use getters instead of exported globals

## 2.0.5

### Patch Changes

- 3dd62b4: add CommonJS package.json generation in generate-legacy-entries script

## 2.0.4

### Patch Changes

- 89bff58: Fix an issue where unchanged promises didn't propagate pending state

## 2.0.3

### Patch Changes

- aa56f71: Add additional transform options and improve transform performance

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
