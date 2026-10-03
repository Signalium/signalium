---
title: signalium/config
nextjs:
  metadata:
    title: signalium/config API
    description: Configuration API
---

## Functions

### setConfig

```ts
export function setConfig(
  cfg: Partial<{
    scheduleFlush: (fn: () => void) => void;
    runBatch: (fn: () => void) => void;
    renderLeaseTtl: number;
    reactDelivery: 'sync' | 'state';
    scheduleReactDelivery: (fn: () => void) => void;
  }>,
): void;
```

Override scheduling hooks for your environment. There are two scheduling hooks that can be overridden:

- `scheduleFlush`: This hook is used to schedule Watchers and Relays to be flushed. When Signals are updated, any Watchers or Relays that they are connected to will be scheduled in a queue. The next time `scheduleFlush` is called, we crawl the queue and find all of the Signals that were updated, then reverse-flush them, running all Reactives that consume them, then if they changed, running their consumers, and so on. This continues recursively until we reach the Watchers and/or Relays that they were connected to, and if they changed, we schedule their listeners to run in `runBatch`.

  The reason we do this process recursively from the Watchers and Relays outward is to ensure that we only run the minimal set of Reactives that need to be run to update the UI, including conditional branches that may change due to execution order. Running from a given Watcher enables us to keep the current "callstack" as we reiterate the function, which means we can process each child in the order that it was originally called, ensuring correctness.

  Lastly, if any Reactive Promises change state or resolve during execution, we schedule another flush after a microtask has passed to ensure that the changes are propagated to the next layer of Reactives. This allows us to coalesce all changes from a single set of updates, including any promise resolutions, into a single batch that we then send to the renderer.

- `runBatch`: This hook is used to run a batch of changes within a rendering framework, so that only a single rendering pass is triggered for multiple changes. This is typically not necessary with modern frameworks that have batching built in, but is still useful for frameworks that don't, e.g. React prior to Concurrent Mode.

React-specific options:

- `reactDelivery`: how `component()`, `useReactive` and `useReactiveShallow` deliver signal changes to React. `'sync'` (the default) uses `useSyncExternalStore`: every update renders at React's synchronous priority, which keeps the tree consistent but restarts any in-progress transition, so under a steady stream of updates a transition can only finish when React's expiry forces it. `'state'` subscribes on commit and delivers changes with a default-priority `setState`, coalesced per component and batched across components; default-priority updates wait for an in-progress transition instead of restarting it. See [Update delivery and transitions](/core/react#update-delivery-and-transitions) for the consistency trade-off. The mode is read when a component mounts; each reader can override it with `{ delivery }`.
- `scheduleReactDelivery`: schedules the flush of pending `'state'` deliveries (default: a microtask). All readers notified before the flush update in one `runBatch`. It must not run the flush inside `startTransition`.
- `renderLeaseTtl`: how long (ms) a watch taken during a render that React never commits stays alive before it is released (default 10 000).

| Parameter                 | Type                       | Description                                     |
| ------------------------- | -------------------------- | ----------------------------------------------- |
| cfg.scheduleFlush         | `(fn: () => void) => void` | Schedule flush function                         |
| cfg.runBatch              | `(fn: () => void) => void` | Run synchronous batch                           |
| cfg.renderLeaseTtl        | `number`                   | Lifetime of an unclaimed render watch, in ms    |
| cfg.reactDelivery         | `'sync' \| 'state'`        | Default delivery mode for React readers         |
| cfg.scheduleReactDelivery | `(fn: () => void) => void` | Schedule the flush of pending `'state'` updates |
