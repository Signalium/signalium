---
'signalium': minor
---

React render-time watches are now leases. `component()`, `useReactive` and `useReactiveShallow` watch their signal while rendering so relays read during the render activate, but React can discard a render (an interrupted transition, a mount that suspends, a StrictMode double render) without ever subscribing or running an effect, and the watch — with every relay under it — stayed active for the rest of the session. The render-time watch is now a provisional lease: the store subscription React makes on commit claims it (keeping the relays warm, with no restart), and a lease nobody claims is released after `renderLeaseTtl` (default 10 s, configurable via `setConfig`; a lease lives between one and two TTLs). A render that suspends keeps its lease until the thrown thenable settles. Committed components behave exactly as before.

`useReactive` and `useReactiveShallow` now register with `PauseSignalsProvider` on commit instead of during render, so un-pausing no longer re-watches a signal from a discarded render.

New: `retain(fn, { ttl })` keeps `fn`'s relays/queries watched for `ttl` ms (or until the returned release function is called) — an app-level lease for prefetching or keeping a hidden surface warm. `signalium/debug` exports `getRenderLeaseCount()` and `releaseRenderLeases()`.
