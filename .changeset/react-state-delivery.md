---
'signalium': minor
---

New opt-in `'state'` delivery mode for React readers. By default `component()`, `useReactive` and `useReactiveShallow` reach React through `useSyncExternalStore`, which always renders at SyncLane and throws away any in-progress transition render; with live data ticking underneath, a transition only finishes at React's ~5 s expiry. In `'state'` mode a reader reads its signal directly during render, subscribes on commit (claiming its render lease), and delivers changes with a default-priority `setState`, coalesced per reader and flushed for all readers in one `runBatch` on a microtask (`scheduleReactDelivery`). Default-priority updates wait for an in-progress transition instead of restarting it. A change between render and subscribe, or during a delivered render, is caught by a version check on commit.

Enable globally with `setConfig({ reactDelivery: 'state' })` (the default stays `'sync'`), or per reader with `component(fn, { delivery })`, `useReactive(fn, { delivery })` and `useReactiveShallow(fn, { delivery })`. The mode is fixed when a reader mounts. Trade-off: updates are consistent per delivery batch, but a reader that mounts while a delivery is pending can show a newer value than its already-mounted siblings for one commit; readers whose values must stay correlated keep `'sync'`.
