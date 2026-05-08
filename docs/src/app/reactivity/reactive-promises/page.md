---
title: Reactive promises
---

When a [reactive function](/reactivity/reactive-functions) is `async`, Signalium returns a **reactive promise** — a promise that the reactive graph understands. It behaves like a normal `Promise<T>` (you can `await` it, compose it with `Promise.all`, attach `.then`) but it also exposes its current state as reactive properties, so consumers can render loading, error, and success states declaratively.

```ts
import { signal, reactive } from 'signalium';

const userId = signal('1');

const loadUser = reactive(async (id: string) => {
  const res = await fetch(`/api/users/${id}`);
  return res.json() as Promise<{ id: string; name: string }>;
});

// Imperative: await the result.
const userA = await loadUser('1');

// Declarative: read the current state of the promise.
const current = loadUser(userId.value);
if (current.isPending) console.log('loading…');
if (current.isReady) console.log(current.value);
```

Same call, two mental models. Use whichever fits the code you're writing.

## The `ReactivePromise` interface

Every async reactive function returns a value with this shape. `ReactivePromise<T>` is a discriminated union of "not yet ready" and "ready" — the `isReady` flag narrows `value` from `T | undefined` to `T`:

```ts
interface PendingReactivePromise<T> extends Promise<T> {
  readonly value: undefined;
  readonly error: unknown;

  readonly isPending: boolean;
  readonly isResolved: boolean;
  readonly isRejected: boolean;
  readonly isSettled: boolean;
  readonly isReady: false;
}

interface ReadyReactivePromise<T> extends Promise<T> {
  readonly value: T;
  readonly error: unknown;

  readonly isPending: boolean;
  readonly isResolved: boolean;
  readonly isRejected: boolean;
  readonly isSettled: boolean;
  readonly isReady: true;
}

type ReactivePromise<T> = PendingReactivePromise<T> | ReadyReactivePromise<T>;
```

The state fields mean:

- **`value`** — the most recent successfully-resolved value when `isReady` is `true`; otherwise `undefined`. Stays set between reruns, so you can keep showing the previous result while the next one loads.
- **`error`** — the most recent rejection, or `undefined`.
- **`isPending`** — a new run is in flight.
- **`isResolved`** — the most recent run resolved.
- **`isRejected`** — the most recent run rejected.
- **`isSettled`** — has settled (resolved or rejected) at least once.
- **`isReady`** — has resolved at least once; `value` is guaranteed to be `T`. The difference from `isResolved` matters when the *current* run is pending but a *previous* run already produced a value. Because `isReady` discriminates the union, `if (p.isReady) { /* p.value: T */ }` narrows `value` directly with no `undefined` check needed.

Each of these is a reactive read. Accessing them inside a reactive function or component registers a dependency, and the consumer re-runs when the promise transitions.

## Async reactive functions

Mark a reactive function `async` and Signalium converts its return value into a reactive promise:

```ts
const fetchJson = reactive(async (url: string) => {
  const res = await fetch(url);
  return res.json();
});

// Awaiting works as you'd expect.
const user = await fetchJson('/api/users/1');
```

The reactive function itself is still memoized on its arguments and tracked signals, just like a synchronous reactive. But now each memoized slot holds a *reactive promise* — a live handle to the async work.

```ts
const loadUser = reactive(async (id: string) => {
  const res = await fetch(`/api/users/${id}`);
  return res.json();
});

const a = loadUser('1');
const b = loadUser('1');
// a and b are the same ReactivePromise instance; fetch is only called once.
```

Re-calling with the same arguments returns the same promise. Re-calling when a tracked signal changes creates a new run — but the handle you read state from is the same, and its `.value` from the previous run stays populated until the new run settles.

### Signals inside async reactives

Signals read before the first `await` become dependencies the same way as in synchronous reactives. Signalium also tracks reads after an `await` through the **async transform** in the Signalium Babel preset, so you can keep writing normal `async/await` code:

```ts
import { signal, reactive } from 'signalium';

const userId = signal('1');
const includeFriends = signal(false);

const loadUser = reactive(async () => {
  const res = await fetch(`/api/users/${userId.value}`);
  const user = await res.json();

  if (includeFriends.value) {
    const friendsRes = await fetch(`/api/users/${user.id}/friends`);
    user.friends = await friendsRes.json();
  }

  return user;
});
```

If either signal changes, the reactive re-runs from the top. Dependencies taken during the previous run are discarded and rebuilt from scratch.

### Composing reactive promises

Reactive promises are still real promises, so all the usual combinators work:

```ts
const loadA = reactive(async () => { /* ... */ });
const loadB = reactive(async () => { /* ... */ });
const loadC = reactive(async () => { /* ... */ });

const loadAll = reactive(async () => {
  const [a, b, c] = await Promise.all([loadA(), loadB(), loadC()]);
  return { a, b, c };
});
```

`Promise.all`, `Promise.race`, `Promise.allSettled`, `Promise.any`, `try`/`catch` — all the semantics you know transfer over unchanged.

### Errors

Errors are part of the reactive state. You can handle them imperatively with `try`/`catch`:

```ts
const safeLoad = reactive(async (id: string) => {
  try {
    return await loadUser(id);
  } catch (err) {
    return { fallback: true };
  }
});
```

…or declaratively via `isRejected` and `error`:

```ts
const render = reactive((id: string) => {
  const user = loadUser(id);

  if (user.isPending) return 'Loading…';
  if (user.isRejected) return `Error: ${(user.error as Error).message}`;
  return user.value?.name ?? 'Unknown';
});
```

A rejection does not invalidate the previously-resolved `value`. If you want "show last good data while refetching, but show an error if the refetch fails", read `isReady`, `value`, `isRejected`, and `error` independently — they're designed to be composed.

## Declarative vs imperative reads

The two styles compose naturally, and you'll frequently mix them:

```ts
const loadUser = reactive(async (id: string) => {
  const res = await fetch(`/api/users/${id}`);
  return res.json() as Promise<{ id: string; name: string }>;
});

// Imperative — waits for the promise, proceeds with a concrete value.
const loadUserName = reactive(async (id: string) => {
  const user = await loadUser(id);
  return user.name;
});

// Declarative — returns a synchronous string based on the current state.
const userNameOrLoading = reactive((id: string) => {
  const user = loadUser(id);
  return user.isPending ? 'Loading user…' : user.value?.name ?? 'Unknown';
});
```

Rule of thumb:

- **Imperative (`await`)** is best when the downstream code *needs* the value to make progress. Good for chaining async work.
- **Declarative (state reads)** is best when the downstream code can render or compute something useful in any state. Good for UI.

## Tasks

Reactive promises returned by async `reactive` functions represent **data** — a value derived from some input. They run automatically whenever a consumer reads them and their inputs change.

But sometimes you have async work that isn't data. A save button. A "retry" action. A mutation. You don't want it to run automatically — you want to fire it on demand and observe its state while it runs.

You *could* roll that yourself with a signal holding a promise:

```ts
import { signal, reactive } from 'signalium';
import type { ReactivePromise } from 'signalium';

const updateUser = reactive(async (id: string, name: string) => {
  const res = await fetch(`/api/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
  return res.json() as Promise<{ id: string; name: string }>;
});

// Holds the current in-flight or most-recent promise.
const currentUpdate = signal<ReactivePromise<{ id: string; name: string }> | undefined>(undefined);

function triggerUpdate(id: string, name: string) {
  currentUpdate.value = updateUser(id, name);
}
```

It works, but it's clunky: you have to keep a signal around, you have to unwrap it twice (`currentUpdate.value?.isPending`), and every re-invocation swaps out the promise reference.

Reactive **tasks** bake this pattern in. A task is a reactive promise with a `run(...)` method. It starts in an inert state, transitions into `isPending` when you call `run`, and updates its state fields as the underlying async work settles.

```ts
import { task } from 'signalium';

const updateUserTask = task(async (id: string, name: string) => {
  const res = await fetch(`/api/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
  return res.json() as Promise<{ id: string; name: string }>;
});

// Run it whenever you want.
updateUserTask.run('1', 'Tony Stark');

// Observe state reactively.
console.log(updateUserTask.isPending);
console.log(updateUserTask.value);
```

Arguments passed to `run` are forwarded to the underlying function. Calling `run` again while a previous run is in flight replaces the in-flight promise — the new run's state takes over, and the task's `value` remains the last successful result until the new one settles.

### Tasks inside reactive functions

Tasks are most useful when they're **owned** by a reactive function: one task per logical context, memoized by the reactive's arguments.

```ts
import { reactive, task } from 'signalium';

const userUpdaterFor = reactive((id: string) => {
  return task(async (name: string) => {
    const res = await fetch(`/api/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    });
    return res.json() as Promise<{ id: string; name: string }>;
  });
});

const t1 = userUpdaterFor('1');
const t2 = userUpdaterFor('1'); // same task, cached by id
const t3 = userUpdaterFor('2'); // different task for a different user
```

Each user id gets its own task instance. The state of one update doesn't bleed into another, but you're also not allocating a new task every render.

### Tasks vs. async reactives

A useful split:

| | Async `reactive` | `task` |
| --- | --- | --- |
| When does it run? | Automatically, when consumed | Manually, via `run(...)` |
| Re-runs on signal change? | Yes | No |
| Represents | Data derived from inputs | An action or mutation |
| Good for | Fetching, computing, deriving | Saving, sending, triggering |

If you catch yourself writing "I want this to run when the user clicks a button" — that's a task. If you're writing "I want this value to always reflect the latest server state" — that's an async reactive.

### Anti-pattern: running tasks from reactive functions

```ts
// Avoid.
const sideEffect = reactive(() => {
  myTask.run(someSignal.value);
});
```

Tasks are mutations. Running a mutation as a side effect of a reactive computation mixes reads and writes in a way that's hard to reason about and can violate [signal purity](/reactivity/reactive-functions#signal-purity). If you need async data that updates when signals change, use an async reactive function — not a task.

## Integrating with Suspense

When the React integration sees an unresolved reactive promise inside a `component(...)`, it integrates with React's Suspense boundary automatically — no special APIs, no manual suspending. That's covered in more detail on the [async components page](/components/async); this page focuses on the underlying reactive-promise behavior.

## Testing and flushing

If you're writing tests that assert on state transitions of a reactive promise, the scheduler will typically have pending work between a signal write and the observable state update. Call `settled()` from `signalium` to await the in-flight flush:

```ts
import { settled } from 'signalium';

userId.value = '2';
await settled();
expect(loadUser(userId.value).isPending).toBe(false);
```

See [Scheduling & batching](/reactivity/scheduling) for more.

## Next steps

- [Relays](/reactivity/relays) — push-based reactive sources for events and subscriptions.
- [Async components & Suspense](/components/async) — using reactive promises in React.
- [`task` API reference](/api/signalium#task)
- [`ReactivePromise` API reference](/api/signalium#reactivepromise)
