---
title: Watchers
---

A **watcher** is an exit point from the reactive graph. Every other primitive in Signalium — [signals](/reactivity/signals), [reactive functions](/reactivity/reactive-functions), [reactive promises](/reactivity/reactive-promises), [relays](/reactivity/relays) — is pull-based: they only do work when someone asks. A watcher is what does the asking.

```ts
import { signal, reactive, watcher } from 'signalium';

const count = signal(0);

const plusOne = reactive(() => count.value + 1);

const w = watcher(() => plusOne());

const stop = w.addListener(() => {
  console.log('changed to', w.value);
});

count.value = 5; // eventually logs "changed to 6"
stop();
count.value = 10; // nothing
```

A watcher watches a reactive computation. When you add a listener, the watcher activates — it starts actively pulling on its dependency graph and scheduling re-runs whenever anything it depends on changes. When the last listener is removed, the watcher deactivates, and the graph downstream of it becomes eligible for deactivation too.

## Why watchers exist

The rest of Signalium is lazy. Reactive functions don't run until you call them. Reactive promises don't fire until something consumes them. Relays don't activate until someone subscribes. None of that is useful on its own — laziness without an active consumer means nothing ever happens.

Watchers are the "someone's watching this" signal. They tell the graph:

- **When to run.** A watcher will re-run whenever its dependencies change, so its listeners can be notified.
- **What's alive.** Anything reachable from an active watcher is considered *active*, which is what keeps relays connected to their external sources.
- **When to tear down.** When no active watcher can reach a node, it becomes inactive; relays call their `deactivate` hooks, caches can be freed, and so on.

Without watchers, Signalium is a nicely-tracked memoization layer. With watchers, it becomes a live reactive system.

## Creating a watcher

```ts
import { watcher } from 'signalium';

const w = watcher(() => {
  // Any reactive reads here become dependencies of the watcher.
  return someReactive();
});
```

The function passed to `watcher(...)` runs just like a reactive function. Every signal and reactive function it reads becomes a tracked dependency. When any dependency changes, the watcher will be scheduled to re-run.

A watcher isn't active the moment you create it. Creating a watcher is cheap — it's just a container. Activation happens when you attach a listener.

## Adding listeners

```ts
const stop = w.addListener(() => {
  console.log('value is now', w.value);
});
```

`addListener(cb)` does three things:

1. **Activates the watcher** (if it wasn't already), causing it to run its computation and register dependencies.
2. **Activates everything reachable** from the watcher's computation. Relays in the dependency graph call their activation functions.
3. **Registers the callback** to fire whenever the watcher's output changes.

Each call to `addListener` returns a function you can call to stop listening:

```ts
const stop = w.addListener(cb);

// Later…
stop();
```

When the last listener on a watcher is removed, the watcher deactivates. Anything that was active only because of this watcher becomes inactive too, triggering relay teardowns and cache eviction.

You can attach multiple listeners to the same watcher. They all fire on each update, and the watcher stays active as long as any of them are attached.

## Listener semantics

The listener callback runs when the **output of the watcher's function** changes — not when any dependency changes. If a dependency changes but the watcher's return value is structurally the same as before, listeners are not invoked.

```ts
import { signal, watcher } from 'signalium';

const a = signal(1);
const b = signal(2);

const w = watcher(() => a.value + b.value);

w.addListener(() => console.log('sum changed to', w.value));

a.value = 2;
b.value = 1;
// Dependencies changed, but the sum is still 3 — the listener does not fire.
```

This is the same propagation rule that applies throughout Signalium: if a reactive function's output didn't change, its consumers aren't invalidated. The watcher is just one more consumer.

Inside the listener callback, read `w.value` to get the latest watched value. Don't try to re-invoke the watcher function — it's already run, and its result is memoized on the watcher.

## Scheduling

Listeners do not fire synchronously at the moment a signal is written. They're scheduled to fire during the next **flush**, which normally happens on the next macrotask (`setTimeout(..., 0)`) but is configurable via [`setConfig`](/reactivity/scheduling).

```ts
const count = signal(0);
const w = watcher(() => count.value);

w.addListener(() => console.log('fired'));

count.value = 1;
count.value = 2;
count.value = 3;
// One listener call, with w.value === 3, on the next tick.
```

All writes between flushes are coalesced. Listeners see the final state, not the intermediate transitions. This matters a lot in practice — it means a burst of updates that all land in the same event turn results in one listener call, one React re-render, one observable transition, rather than one per write.

Crucially, though, this does **not** affect pull-based reads. If you write a signal and then immediately read a reactive function that depends on it, the reactive function runs on demand and returns the up-to-date value. The watcher is still scheduled, but it's not blocking synchronous reads:

```ts
const count = signal(0);

const plusOne = reactive(() => count.value + 1);

const w = watcher(() => plusOne());
w.addListener(() => {});

count.value = 5;
plusOne(); // 6, immediately — not waiting for the flush
```

See [Scheduling & batching](/reactivity/scheduling) for the full picture.

## Watchers as the root of "active"

Every reactive node in Signalium can be in one of two states: **active** or **inactive**. Activity propagates:

- A watcher is active while it has at least one listener.
- A reactive function is active while it's reachable from an active watcher.
- A relay is active while it's reachable from an active watcher.
- A signal doesn't really have an activity state of its own — it's passive state — but its subscribers determine its liveness.

The only thing that can introduce activity into the graph is a watcher. This is why [relays](/reactivity/relays) only run when watched: relays consume resources, resources need a clear owner, and watchers are the one and only entity that can claim ownership.

Once activity starts flowing:

- Writing to an active signal causes its active subscribers to be scheduled.
- Reactive functions re-compute as needed to produce output for the watcher.
- Relays react to changes via their `update` hook or by re-activating.
- When the watcher's output changes, its listeners fire.

And when a watcher deactivates:

- Everything it uniquely kept active deactivates too.
- Relays call their `deactivate` hooks.
- Cached reactive values may be discarded.

## Isolation

By default, a watcher inherits the [context](/reactivity/contexts) scope from wherever it was created. Sometimes you want a watcher to be completely independent — not to share caches with the surrounding environment, not to read any inherited contexts. Pass `isolate: true`:

```ts
import { watcher } from 'signalium';

const w = watcher(() => someComputation(), { isolate: true });
```

An isolated watcher gets its own fresh scope. Reactive functions it invokes don't share their memoized results with other callers outside this watcher. This is occasionally useful for sandboxed scenarios — rendering a preview of the graph under different context values, or running a background computation in a test — but most application code should leave it off.

## Watchers and framework integrations

In an app built on top of Signalium, you usually don't create watchers by hand. The framework integration does it for you. `signalium/react`'s `component(...)` and `useReactive(...)` both create a watcher under the hood and wire it up to React's rendering lifecycle:

```tsx
import { component } from 'signalium/react';
import { signal, reactive } from 'signalium';

const count = signal(0);
const doubled = reactive(() => count.value * 2);

const Counter = component(() => {
  // Reading `doubled()` here is the same as wrapping it in a watcher
  // whose listener tells React to re-render this component.
  return <p>{doubled()}</p>;
});
```

When a React component using `component(...)` mounts, the integration adds a listener to the internal watcher. When it unmounts, the listener is removed, which lets the graph downstream tear down if nothing else is watching.

You only need to create a watcher manually when you're bridging to something *other* than React — a DOM event, an external observable library, a server-side render loop, or a test harness that wants to assert on signal state.

{% callout type="warning" title="Do not create watchers inside reactive code" %}
Watchers are terminal nodes. They should be created in whatever "outer shell" owns the consumer side of your app — the framework integration, or a top-level setup block. Creating a watcher inside a reactive function or a relay activation creates cycles and resource leaks that Signalium cannot automatically manage.

If you need to react to updates from inside the graph, use a relay instead.
{% /callout %}

## Driving relays with watchers

Because relays only activate when a watcher can reach them, the most common reason to manually create a watcher outside of a framework integration is to intentionally hold a relay active:

```ts
import { relay, watcher } from 'signalium';

const timer = relay<number>((state) => {
  state.value = 0;
  const id = setInterval(() => state.value!++, 1000);
  return () => clearInterval(id);
});

// Nothing is watching timer — the interval is not running.

const keepAlive = watcher(() => timer.value);
const stop = keepAlive.addListener(() => {});

// Now the interval is running for as long as the listener stays attached.
stop();
// Interval cleared.
```

This pattern shows up in tests and in one-off scripts. In an app, you'd normally just consume the relay from a component and let React's lifecycle drive activation.

## Next steps

- [Scheduling & batching](/reactivity/scheduling) — the flush cycle that drives watchers.
- [Relays](/reactivity/relays) — the primary reason you'll care about watcher lifecycle.
- [Components & async](/components/async) — how `signalium/react` uses watchers behind the scenes.
- [`watcher` API reference](/api/signalium#watcher)
