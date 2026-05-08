---
'signalium': minor
---

Remove the implicit `console.error('[signalium] Unhandled async error...')`
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
