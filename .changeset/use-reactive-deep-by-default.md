---
'signalium': major
---

`useReactive` is now thunk-only and deep-by-default.

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
