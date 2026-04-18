---
'signalium': minor
---

Add thunk form to `useReactive` and `useReactiveDeep` with Babel auto-memoization.

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
