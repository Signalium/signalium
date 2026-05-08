---
title: Scheduling & batching
---

Signalium is a pull-based reactive system with an asynchronous flush. Writes to [signals](/reactivity/signals) don't immediately run [watchers](/reactivity/watchers) or fire listeners — they mark the graph as dirty and schedule a **flush** for later. When the flush runs, it walks the dirty graph, re-computes what changed, and calls the listeners whose output actually updated.

This two-step model (immediate dirtying, deferred flush) is what makes Signalium both **synchronously correct** for pull-based reads and **efficient** for push-based notifications. Understanding the difference between the two explains most of the scheduling behavior you'll encounter.

## Pull vs. push

There are two ways data moves through the graph:

- **Pull.** Code calls a reactive function or reads a signal. If anything relevant has changed, the value is recomputed on the spot. This path runs synchronously and always returns up-to-date data.
- **Push.** A watcher's listener is invoked because something it was observing changed. This path runs asynchronously, during a flush.

Both paths operate on the same graph; they just differ in timing.

```ts
import { signal, reactive, watcher } from 'signalium';

const count = signal(0);
const plusOne = reactive(() => count.value + 1);

const w = watcher(() => plusOne());
w.addListener(() => console.log('listener fired', w.value));

count.value = 5;

// Pull: synchronous, returns the latest value now.
console.log(plusOne()); // 6

// Push: the listener fires during the next flush.
// Eventually logs: "listener fired 6"
```

Writing to `count` doesn't block on the listener. Reading `plusOne()` doesn't wait for the flush. Both mental models run in parallel against the same underlying dirty state.

## The flush cycle

At a high level, a flush does the following:

1. **Collect** every watcher that has dirty dependencies since the last flush.
2. **Pull from the watcher outward**, re-running only the reactive functions whose outputs could have changed. Reactive functions whose output is still the same after re-evaluation are *not* treated as changed, and their consumers are skipped.
3. **If a watcher's output changed**, mark it for listener notification.
4. **Run listeners** in a batch (optionally wrapped in `runBatch` — see [`setConfig`](#customizing-the-scheduler)).

The reason we walk from watchers *outward* — rather than from dirty signals *inward* — is that reactive functions use [dynamic dependency tracking](/reactivity/reactive-functions#dependency-tracking). Which dependencies matter depends on the current state of the graph, and the only way to know is to start at a consumer and ask "what does this now depend on?" Walking from writes inward would require evaluating every possible branch of the graph, which defeats the point.

A few important properties fall out of this:

- **Multiple writes between flushes coalesce.** Ten writes to the same signal produce at most one listener call.
- **Listeners only fire when their watched value actually changed.** Transitions that round-trip (write `a` then write back the original value) don't notify.
- **Reactive promises get their own flush.** If any reactive promise resolves or transitions during the main flush, another flush is scheduled after the microtask queue drains, so downstream state picks up the new value in the next batch.

## Timing of writes and reads

This is the single most important property of scheduling, and it's worth stating explicitly:

**Writing a signal and then immediately reading a reactive function that depends on it works.** Pull-based reads are synchronous and always see the latest state.

```ts
const count = signal(0);
const derived = reactive(() => count.value + 1);

count.value = 1;
derived(); // 2, right now. No waiting.
```

Scheduling only affects the *push* side — when listeners run, when watchers notify their consumers, when React schedules a re-render. If you need up-to-date data *right now*, read it. The flush is a concurrency optimization for observers, not a delay that you need to work around.

When a flush does eventually run, anything that was already pulled and cached isn't re-computed. The watcher reads the cached value and determines it hasn't changed from the listener's perspective either.

## Customizing the scheduler

By default, flushes run on the next macrotask (`setTimeout(flush, 0)`). That's a sensible default: it lets any microtask work (promise callbacks, `queueMicrotask`) finish and coalesces everything in a single browser turn into one flush.

You can override this with `setConfig` from `signalium/config`:

```ts
import { setConfig } from 'signalium/config';

setConfig({
  scheduleFlush: (fn) => {
    // Run the flush however you want — on a microtask, during
    // requestAnimationFrame, in a custom scheduler, etc.
    queueMicrotask(fn);
  },
});
```

`scheduleFlush` is called with a function to execute "later". When you're ready to flush, call it. Signalium guarantees a new flush won't be scheduled until the previous one has run, so a straightforward implementation like the one above works.

### `runBatch` for external frameworks

`setConfig` also accepts a `runBatch` hook. It wraps the portion of the flush that fires listeners, letting a framework batch any resulting work:

```ts
import { setConfig } from 'signalium/config';
import { unstable_batchedUpdates } from 'react-dom';

setConfig({
  runBatch: (fn) => unstable_batchedUpdates(fn),
});
```

With modern React (concurrent mode), explicit batching is rarely needed — the default pass-through is fine. Legacy React 16/17 and certain non-React frameworks benefit from a `runBatch` that tells their renderer "here's a coherent set of updates, please process them together".

## Flushing in tests

In test code, you often want to write a signal, then assert on what a watcher observed. Because listeners only fire during a flush, you have to wait for the flush to happen.

Signalium exposes `settled()` for this:

```ts
import { signal } from 'signalium';
import { settled } from 'signalium';

const count = signal(0);

count.value = 5;
await settled();
// All scheduled flushes have completed; listeners have fired.
```

`settled()` returns a promise that resolves when the current flush (and any flushes it causes, including async promise-resolution flushes) have finished. It's idempotent — calling it with no pending work resolves immediately.

Many test suites also define a simple `nextTick` helper to skip exactly one microtask:

```ts
const nextTick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

count.value = 5;
await nextTick(); // or await settled();
```

`settled()` is the safer choice — it guarantees *all* scheduled work is done, not just "one microtask worth". Use `nextTick` only when you specifically want to peek at intermediate state.

### Awaiting reactive promises

For reactive promises, you usually don't need `settled()` at all — you can just `await` the promise:

```ts
const user = loadUser('1');
await user;
expect(user.isReady).toBe(true);
```

`settled()` comes into play when you want to assert on *watcher output* or *listener side-effects* in response to a signal change, not when you want a single async value.

## Summary

- Writes schedule a flush; they don't run watchers synchronously.
- Reads (pull) are always synchronous and up-to-date.
- Flushes coalesce multiple writes; listeners see the net effect.
- The default scheduler runs on the next macrotask; customize it with [`setConfig`](/api/signalium/config).
- In tests, `await settled()` to deterministically wait for all pending flushes.

## Next steps

- [Watchers](/reactivity/watchers) — the consumers that scheduling ultimately serves.
- [Reactive promises](/reactivity/reactive-promises) — how async state transitions interact with flushing.
- [`setConfig` API reference](/api/signalium/config) — full scheduler customization.
