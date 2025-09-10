---
title: signalium
nextjs:
  metadata:
    title: signalium
    description: Root package API
---

## Functions

---

### signal

```ts
function signal<T>(initialValue: T, opts?: SignalOptions<T>): Signal<T>;
```

Creates a Signal instance of type `T`.

```ts
import { signal } from 'signalium';

const count = signal(0);

// Read
console.log(count.value); // 0

// Write
count.update((v) => v + 1);
count.value = 2; // equivalent direct set
```

| Parameter    | Type               | Description                  |
| ------------ | ------------------ | ---------------------------- |
| initialValue | `T`                | Initial value for the signal |
| opts         | `SignalOptions<T>` | See Types below              |

---

### reactive

```ts
function reactive<T, Args extends unknown[]>(
  fn: (...args: Args) => T,
  opts?: ReactiveOptions<T, Args>,
): ReactiveFn<T, Args>;
```

Creates a Reactive Function that re-computes when its dependencies change. Async functions return a `ReactivePromise`.

Reactive Functions cache by parameters and automatically track reads of Signals and other Reactive Functions.

```ts
import { signal, reactive } from 'signalium';

const first = signal('Ada');
const last = signal('Lovelace');

const fullName = reactive(() => `${first.value} ${last.value}`);

console.log(fullName()); // "Ada Lovelace"
first.value = 'Grace';
last.value = 'Hopper';
console.log(fullName()); // updates to "Grace Hopper"

// Parameterized reactive function (memoized by paramKey or args)
const power = reactive((base: number) => base * base);
console.log(power(4)); // 16
console.log(power(5)); // 25
```

| Parameter | Type                       | Description          |
| --------- | -------------------------- | -------------------- |
| fn        | `(...args: Args) => T`     | Computation function |
| opts      | `ReactiveOptions<T, Args>` | See Types below      |

---

### relay

```ts
export function relay<T>(
  activate: RelayActivate<T>,
  opts?: SignalOptions<T>,
): ReactivePromise<T>;
```

Creates a long-lived reactive promise for event-like async sources. Relays are great for subscriptions, sockets, timers, or any producer that can push multiple updates over time.

```ts
import { relay } from 'signalium';

const time = relay<number>((state) => {
  const id = setInterval(() => (state.value = Date.now()), 1000);
  return () => clearInterval(id);
});

console.log(time.isPending); // true initially
setTimeout(() => {
  if (time.isReady) console.log(time.value); // current timestamp
}, 1500);
```

| Parameter | Type               | Description                               |
| --------- | ------------------ | ----------------------------------------- |
| activate  | `RelayActivate<T>` | Activation function controlling the relay |
| opts      | `SignalOptions<T>` | See Types below                           |

#### RelayActivate

```ts
export type RelayActivate<T> = (
  state: RelayState<T>,
) => RelayHooks | (() => unknown) | void | undefined;
```

Called when a relay is first observed (activated). Use `state` to push values or errors. Return an object of hooks or a teardown function to manage external resources.

- Returning `{ update?(), deactivate?() }` lets you signal external changes (`update`) and clean up on deactivation (`deactivate`).
- Returning a function is treated as a teardown equivalent to `{ deactivate() { /* ... */ } }`.

| Parameter | Type            | Description                                         |
| --------- | --------------- | --------------------------------------------------- |
| state     | `RelayState<T>` | Imperative API to push values/errors into the relay |

#### RelayState

```ts
export interface RelayState<T> {
  value: T | undefined;
  setPromise: (promise: Promise<T>) => void;
  setError: (error: unknown) => void;
}
```

| Property   | Type                            | Description                                                                                                            |
| ---------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| value      | `T \| undefined`                | Current value snapshot                                                                                                 |
| setPromise | `(promise: Promise<T>) => void` | Push an async result. Updating the relay this way will cause it to go into a pending state until the promise resolves. |
| setError   | `(error: unknown) => void`      | Push an error                                                                                                          |

#### RelayHooks

```ts
export type RelayHooks = {
  update?(): void;
  deactivate?(): void;
};
```

| Property   | Type         | Description                                      |
| ---------- | ------------ | ------------------------------------------------ |
| update     | `() => void` | Update the relay in response to external changes |
| deactivate | `() => void` | Cleanup when the last watcher disconnects        |

---

### task

```ts
export function task<T, Args extends unknown[]>(
  fn: (...args: Args) => Promise<T>,
  opts?: SignalOptions<T>,
): ReactiveTask<T, Args>;
```

Wraps an async function as a runnable reactive task. Tasks expose `run(...args)` to start/restart the underlying promise while preserving a single reactive handle. This is essentially a shorthand for running an async function in an event handler and then assigning the resulting promise to a signal.

```tsx
import { signal, reactive, task } from 'signalium';
import { component } from 'signalium/react';

const updateUser = reactive(async (id: string) => {
  const res = await fetch(`/api/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: 'Tony Stark' }),
  });

  return res.json() as Promise<{ id: string; name: string }>;
});

// 1) Manual async + signal
const UserManual = component(() => {
  // Have to create a signal to hold the promise
  const updatePromise = signal<
    ReactivePromise<{ id: string; name: string }> | undefined
  >();

  return (
    <div>
      {/* Assign the promise to the signal */}
      <button onClick={() => (updatePromise.value = updateUser('1'))}>
        Load
      </button>
      {/* Have to unwrap the promise to access the properties */}
      {updatePromise.value?.isPending && <p>Loading…</p>}
      {updatePromise.value?.isRejected && <p>Error</p>}
      {/* Double unwrapping here is pretty ugly 🤮 */}
      {updatePromise.value?.isReady && <p>{updatePromise.value.value.name}</p>}
    </div>
  );
});

// 2) Task-based
const updateUserTaskFor = reactive((id: string) => {
  return task(async (id: string) => {
    const res = await fetch(`/api/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Tony Stark' }),
    });

    return res.json() as Promise<{ id: string; name: string }>;
  });
});

const UserTask = component(({ id }: { id: string }) => {
  // The task instance is the promise itself
  const updateUserTask = updateUserTaskFor(id);

  return (
    <div>
      {/* We can run the task directly, no need to assign to a signal */}
      <button onClick={() => updateUserTask.run()}>Update user {id}</button>
      {/* We can access properties directly! */}
      {updateUserTask.isPending && <p>Loading…</p>}
      {updateUserTask.error && <p>Error</p>}
      {updateUserTask.isReady && <p>{updateUserTask.value.name}</p>}
    </div>
  );
});
```

| Parameter | Type                            | Description       |
| --------- | ------------------------------- | ----------------- |
| fn        | `(...args: Args) => Promise<T>` | Async computation |
| opts      | `SignalOptions<T>`              | See Types below   |

---

### watcher

```ts
export function watcher<T>(
  fn: () => T,
  opts?: SignalOptions<T> & { tracer?: Tracer; isolate?: boolean },
): Watcher<T>;
```

Subscribes externally to a reactive computation.

```ts
import { signal, watcher } from 'signalium';

const count = signal(0);
const w = watcher(() => count.value);

const stop = w.addListener(() => {
  console.log('count changed to', w.value);
});

count.value = 1;
stop();
```

Watchers are ideal when you need to bridge reactivity to non-reactive environments (DOM, external libs) via listeners. They act as "exit points" for your reactive graph, and are the primary way that Signals are consumed by external consumers. Watchers are also the primary way that relays are activated and deactivated, since nodes only activate when a Watcher is connected to them directly or indirectly.

| Parameter | Type               | Description                |
| --------- | ------------------ | -------------------------- |
| fn        | `() => T`          | Reactive producer to watch |
| opts      | `SignalOptions<T>` | See Types below            |

---

### context

```ts
export function context<T>(initialValue: T, description?: string): Context<T>;
```

Create a new Context. Contexts provide dependency injection. Define a Context at the root and read it downstream without threading props.

```ts
import { context, withContexts, getContext } from 'signalium';

const Theme = context<'light' | 'dark'>('light');

withContexts([[Theme, 'dark']], () => {
  const value = getContext(Theme);
  console.log(value); // 'dark'
});
```

| Parameter    | Type      | Description    |
| ------------ | --------- | -------------- |
| initialValue | `T`       | Default value  |
| description  | `string?` | Optional label |

---

### getContext

```ts
export function getContext<T>(context: Context<T>): T;
```

Read a Context value.

Use inside reactive computations or within a `withContexts`/provider scope.

| Parameter | Type         | Description    |
| --------- | ------------ | -------------- |
| context   | `Context<T>` | Context handle |

---

### withContexts

```ts
export function withContexts<C extends unknown[], U>(
  contexts: [...ContextPair<C>],
  fn: () => U,
): U;
```

Temporarily apply Contexts for a call.

Allows scoping multiple Context values for the duration of a function call.

| Parameter | Type                  | Description            |
| --------- | --------------------- | ---------------------- |
| contexts  | `[...ContextPair<C>]` | Context pairs to apply |
| fn        | `() => U`             | Function to execute    |

---

### reactiveMethod

```ts
export function reactiveMethod<T, Args extends unknown[]>(
  owner: object,
  fn: (...args: Args) => T,
  opts?: ReactiveOptions<T, Args>,
): (...args: Args) => T | DiscriminatedReactivePromise<T>;
```

Like `reactive`, but bound to an owner object for scoping.

Use when the computation should be cached/owned relative to an object instance (e.g., a Context class) rather than globally. This is useful when you want to ensure that a single global store is not affected by child Contexts, since each time a child Context is overridden, a new scope is created and all Reactive Functions are re-evaluated in the new scope.

```ts
import { signal, reactiveMethod } from 'signalium';

class Counter {
  count = signal(0);
  double = reactiveMethod(this, () => this.count.value * 2);
}

const a = new Counter();
const b = new Counter();

a.count.value = 2;
b.count.value = 5;
console.log(a.double()); // 4
console.log(b.double()); // 10
```

When overriding child Contexts, a normal `reactive` function will re-read the new Context values, while a `reactiveMethod` stays bound to its owner's scope and does not.

```ts
import {
  context,
  getContext,
  withContexts,
  reactive,
  reactiveMethod,
} from 'signalium';

// A context that affects computations
const Settings = context({ factor: 2 }, 'settings');

// Create an owner object in a parent scope
withContexts(
  [
    [Settings, { factor: 2 }],
    [context<object>({}, 'owner'), {}],
  ],
  () => {
    const owner = getContext(context<object>({}, 'owner'));

    // Regular Reactive Function reads from the current scope
    const normalMultiply = reactive(
      (x: number) => x * getContext(Settings).factor,
    );

    // reactiveMethod is bound to the parent's owner scope
    const methodMultiply = reactiveMethod(
      owner,
      (x: number) => x * getContext(Settings).factor,
    );

    console.log(normalMultiply(10)); // 20 (factor 2)
    console.log(methodMultiply(10)); // 20 (factor 2)

    // Override Settings in a child scope
    withContexts([[Settings, { factor: 3 }]], () => {
      console.log(normalMultiply(10)); // 30 (uses child factor 3)
      console.log(methodMultiply(10)); // 20 (still uses owner scope factor 2)
    });
  },
);
```

| Parameter | Type                       | Description                        |
| --------- | -------------------------- | ---------------------------------- |
| owner     | `object`                   | Object whose scope owns the method |
| fn        | `(...args: Args) => T`     | Method computation                 |
| opts      | `ReactiveOptions<T, Args>` | See Types below                    |

---

### notifier

```ts
function notifier(opts?: SignalOptions<undefined>): Notifier;
```

Creates a Notifier, a special zero-value Signal used for manual invalidation. Inside a Reactive Function, call `consume()` to depend on the Notifier. Later, calling `notify()` will invalidate dependents so they recompute on next access.

```ts
import { notifier, reactive } from 'signalium';

const n = notifier();
let count = 0;

const get = reactive(() => {
  n.consume();
  return count;
});

get(); // 0
count = 1;
get(); // still 0 (notifier not notified yet)
n.notify();
get(); // 1
```

| Parameter | Type                       | Description     |
| --------- | -------------------------- | --------------- |
| opts      | `SignalOptions<undefined>` | See Types below |

## Types

---

### Signal

```ts
export interface Signal<T> {
  value: T;
  update(updater: (value: T) => T): void;
}
```

| Property | Type                         | Description                                          |
| -------- | ---------------------------- | ---------------------------------------------------- |
| `value`  | `T`                          | Current value                                        |
| `update` | `(updater: (value: T) => T)` | Update in place without consuming the previous value |

---

### SignalOptions

```ts
export interface SignalOptions<T> {
  equals?: (prev: T, next: T) => boolean | false;
  id?: string;
  desc?: string;
}
```

| Property | Type                                       | Description                            |
| -------- | ------------------------------------------ | -------------------------------------- |
| `equals` | `((prev: T, next: T) => boolean) \| false` | Custom equality (false forces updates) |
| `id`     | `string`                                   | Debug identifier                       |
| `desc`   | `string`                                   | Debug description                      |

---

### ReactiveFn

```ts
export type ReactiveFn<T, Args extends unknown[]> = (
  ...args: Args
) => T extends Promise<infer U> ? ReactivePromise<U> : T;
```

| Parameter | Type   | Description        |
| --------- | ------ | ------------------ |
| `...args` | `Args` | Function arguments |

---

### ReactiveOptions

```ts
export interface ReactiveOptions<T, Args extends unknown[]>
  extends SignalOptions<T> {
  paramKey?: (...args: Args) => string | number;
}
```

| Property   | Type                                       | Description                          |
| ---------- | ------------------------------------------ | ------------------------------------ |
| `equals`   | `((prev: T, next: T) => boolean) \| false` | Inherited from SignalOptions         |
| `id`       | `string`                                   | Inherited from SignalOptions         |
| `desc`     | `string`                                   | Inherited from SignalOptions         |
| `paramKey` | `(...args: Args) => string \| number`      | Key to group parameterized instances |

---

### ReactivePromise

```ts
export interface ReactivePromise<T> extends Promise<T> {
  readonly value: T | undefined;
  readonly error: unknown;

  readonly isPending: boolean;
  readonly isRejected: boolean;
  readonly isResolved: boolean;
  readonly isSettled: boolean;
  readonly isReady: boolean;
}
```

| Property     | Type                    | Description                        |
| ------------ | ----------------------- | ---------------------------------- |
| `value`      | `T        \| undefined` | Current resolved value             |
| `error`      | `unknown`               | Current error if rejected          |
| `isPending`  | `boolean`               | Promise is pending                 |
| `isRejected` | `boolean`               | Promise was rejected               |
| `isResolved` | `boolean`               | Promise was resolved               |
| `isSettled`  | `boolean`               | Promise is settled                 |
| `isReady`    | `boolean`               | Value is available (non-undefined) |
