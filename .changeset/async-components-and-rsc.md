---
'signalium': major
---

Add async component support with Suspense + RSC/SSR integration.

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
