---
title: Reactive Promises
nextjs:
  metadata:
    title: Reactive Promises
    description: Working with reactive promises in Signalium
---

Normal reactive functions cover all use cases for _synchronous_ computation, but what about _asynchronous_ computation?

JavaScript has a few ways of dealing with async, but by far the most common one is with _promises_ and _async functions_. Signalium extends promises to add reactivity to them in a declarative way, enabling functional programming patterns alongside traditional imperative ones.

```js
const fetchJson = reactive(async (url: string) => {
  const response = await fetch(url);
  const result = await response.json();

  return result;
});

// Using async/await
const getUserName = reactive(async (id: string) => {
  const user = await fetchJson(`https://example.com/users/${id}`);

  return user.fullName;
});

// Using declarative properties
const getUserNameOrLoading = reactive((id: string) => {
  const user = fetchJson(`https://example.com/users/${id}`);

  return user.isPending ? 'Loading user...' : user.value.fullName;
});
```

## Promises and Reactivity

To understand reactive promises, the first thing to consider is: what does it mean to _react_ to a promise?

Promises are based on an _imperative_ mental model. "Do _this_, wait, _then_ do this." The imperative way of thinking about loading data would be something like:

1. Update the UI to show a loading spinner
2. Fetch the data and wait for it to return
3. Update the UI to hide the loading spinner and display the data

However, we want a _declarative_ way of representing this data, one that derives directly from our state. This way of thinking looks more like:

1. When we are loading data, show the loading spinner
2. When we have data, show the rendered data

The way Signalium handles this is by exposing the various states of a promise as properties:

```ts
interface ReactivePromise<T> extends Promise<T> {
  value: T | undefined;
  error: unknown;
  isPending: boolean;
  isResolved: boolean;
  isRejected: boolean;
  isSettled: boolean;
  isReady: boolean;
}
```

Whenever a reactive function returns a promise, Signalium converts that promise into a reactive promise with these properties.

```js {% visualize=true %}
import { signal, reactive } from 'signalium';

const text = signal('Hello, world');

const getLoader = reactive(async () => {
  const v = text.value;
  await sleep(3000);

  return v;
});

export const getText = reactive(() => {
  const { isPending, value } = getLoader();

  return isPending ? 'Loading...' : value;
});
```

The properties and flags represent the following states:

- `value`: The most recent result of the promise. This will remain the latest result until the next successful rerun of the promise, allowing you to show the previous state while the next state is loading.
- `error`: The most recent error of the promise. This will remain the latest error until the next run, allowing you to show the current error state.
- `isPending`: True when the reactive promise is currently running (e.g. the promise has not yet resolved).
- `isResolved`: True when the reactive promise resolved successfully.
- `isRejected`: True when the reactive promise rejected.
- `isSettled`: True if the reactive promise has resolved at least _once_. This will not be true if the value was set via an `initValue` or if the operation was not async.
- `isReady`: True when the reactive promise has a value. Is always true if you pass an `initValue` in when creating the reactive function that returns the promise, and otherwise becomes true the first time it gets a value.

This mirrors popular libraries such as [TanStack Query](https://tanstack.com/query/latest) and [SWR](https://github.com/vercel/swr) among many others. However, reactive promises have some additional niceties.

### Awaiting results

In addition to the declarative properties, you can also _await_ reactive promises using standard async/await syntax:

```js {% visualize=true %}
let count = signal(0);

const getInnerLoader = reactive(async () => {
  const v = count.value;
  await sleep(3000);
  return v;
});

const getOuterLoader = reactive(async () => {
  const innerValue = await getInnerLoader();

  return innerValue + 1;
});

export const getText = reactive(() => {
  const { isPending, value } = getOuterLoader();

  return isPending ? 'Loading...' : value;
});
```

Execution pauses at await until the awaited Promise settles (resolves or rejects). This guarantees a value or an error before proceeding, eliminating the need for undefined checks and simplifying state management.

### Composing promises

You can compose promises using the standard promise methods like `Promise.all`, `Promise.race`, etc.

```js {% visualize=true %}
let countA = signal(0);
let countB = signal(0);
let countC = signal(0);

const loadA = reactive(async () => {
  const v = countA.value;
  await sleep(1000);
  return v;
});

const loadB = reactive(async () => {
  const v = countB.value;
  await sleep(3000);
  return v;
});

const loadC = reactive(async () => {
  const v = countC.value;
  await sleep(6000);
  return v;
});

const loadABC = reactive(async () => {
  const [a, b, c] = await Promise.all([loadA(), loadB(), loadC()]);

  return a + b + c;
});

export const getText = reactive(() => {
  const { isPending, value } = loadABC();

  return isPending ? 'Loading...' : value;
});
```

This allows you to chain promises together and ensure that all promises are settled before continuing the computation, and it allows you to do so with familiar APIs that users already know and understand.

### Handling errors

You can also handle errors using the semantics of standard `try/catch` syntax in async functions:

```js {% visualize=true %}
let countA = signal(0);

const loadA = reactive(async () => {
  const v = countA.value;

  if (v % 2 === 0) {
    throw new Error('Even number');
  }

  await sleep(2500);
  return v;
});

const loadWithCatch = reactive(async () => {
  try {
    return await loadA();
  } catch (error) {
    return 'Whoops! Something went wrong.';
  }
});

export const getText = reactive(() => {
  const { isPending, value } = loadWithCatch();

  return isPending ? 'Loading...' : value;
});
```

This allows you to handle errors and continue the computation like you would with standard promises. You can also use the `isRejected` and `error` properties to handle errors directly:

```js {% visualize=true %}
let countA = signal(0);

const loadA = reactive(async () => {
  const v = countA.value;

  if (v % 2 === 0) {
    throw new Error('Even number');
  }

  await sleep(2500);
  return v;
});
export const getText = reactive(() => {
  const { isPending, value, isRejected, error } = loadA();

  return isPending
    ? 'Loading...'
    : isRejected
      ? `Error: ${error.message}`
      : value;
});
```

## Reactive Tasks

Async signals are meant to represent _data_, values fetched or generated based on some input (e.g. a URL). In many cases, however, we have an _asynchronous task_ which triggers based on some action or event. For example, you might have a save button that sends a `PATCH` request to the server. You _could_ just handle that in an event handler and not bother with hooks or signals, but you'll likely want to show a loading spinner, or some other indicator that the action is happening.

You can create a special kind of reactive promise directly to handle this, a _task_. Tasks don't run when they are used or accessed, unlike standard promises. Instead, you must run them manually using the `run()` method:

```js
import { task } from 'signalium';

// ...usage
const sendFriendRequest = task(async (userId: string) => {
  fetch(`/api/requests/${userId}`, { method: 'POST' });
});

// runs the request
sendFriendRequest.run(userId);

// The same properties on reactive promises
sendFriendRequest.isPending;
```

The signature for a `TaskSignal` is:

```ts
export interface TaskSignal<T, Args extends unknown[] = unknown[]>
  extends ReactivePromise<T> {
  run(...args: Args): Promise<T>;
}
```

It's important to note that the `task` function creates an _instance_ of a `ReactiveTask`, not a function like regular async functions. This means that each call to `run()` is called on the same instance of the task, and the task result and properties are shared everywhere it is used.

### Creating multiple tasks vs. passing run params

Tasks can receive parameters when `run` is called, and in many cases this is all that is needed for that specific task. Sometimes, however, you may want to create a task factory function instead so that you can define separate tasks based on different values. Consider a task that sets a value in a browser extension's local storage:

```ts
import { reactive, task } from 'signalium';

const createSetStorageValue = reactive((key: string) => {
  return task(async (value) => {
    await chrome.storage.local.set({ [key]: value });
  });
});

// providing build parameters
const setUserId = createSetStorageValue('USER_ID');

// providing run parameters
sendFriendRequest.run('user_1');
```

This allows us to have a task per key in storage, and these tasks can run independently and will have independent state (e.g. `isPending`, `isSettled`, etc), but they can be reused when _setting_ each value so we aren't creating a large number of tasks.

### Anti-pattern: Running tasks reactively

One temptation for tasks is to run them _in response_ to some other data changing. For instance, you might try to set up something like this:

```js
const fetchTask = task((url) => {
  // ...
});

const getCustomComputed = reactive(() => {
  const url = analyticsUrl.value;

  // Track something whenever this function reruns
  fetchTask.run(url);
});
```

Tasks are meant to represent a "write" operation of some sort, effectively updating some state elsewhere. And, like [mutating state in a reactive function](/core/reactive-functions-and-state#can-i-mutate-state-in-a-reactive-function), running mutations as a side effect of running a reactive function is generally an antipattern and can violate signal-purity. If you're considering doing this, some alternatives might be:

1. Running the task in an event or user input handler (though if your here, you've likely considered this already and it's not realistic)
2. Converting the task to an async reactive function and deriving from the value instead (again, likely something you've considered, but it's worth checking!)
3. If the task whose _state_ has no impact on the UI, consider making it a plain async function instead of a task. For instance, in the `analytics` example above, there usually isn't a loading spinner or anything like that shown when we're sending analytics data, so there's no reason for that to be a task over a plain function. Likely it would also batch events together and then manage them all in one place, and that could be a global or a contextual value, but there's no reason for it to be a _reactive_ value as well.

Like with updating state, there is no blanket prohibition on running tasks in your reactive functions, but it can lead to unexpected and difficult to reason about behavior and _should be avoided_.

## Summary

Reactive promises (created via reactive async functions) and tasks are the go-to solutions when dealing with standard, promise-based async in Signalium. To sum up the main points:

- Reactive Promises
  - Superset of standard promises with declarative state for `isPending`, `isResolved`, `value`, etc.
  - Promises returned by reactive functions are converted into reactive promises
  - Only propagate changes when they are fully resolved
  - Can be awaited with `async`/`await` syntax
  - Can be composed with standard promise methods like `Promise.all`, `Promise.race`, etc.
  - Can be used with `try/catch` syntax to handle errors
- Reactive Tasks
  - Used for running an async operation on command
  - Exposes the same state properties as reactive promises
  - Should not be used _reactively_ (e.g. in response to changes in other signals)

Between reactive promises and tasks, most common data fetching and mutation operations should be covered. This is because _most_ async in JavaScript is _symmetric_ - you send one request, you receive one response.

What do we do, however, when we have to deal with _asymmetric_ async? This brings us to the final core types of signals: Relays and Watchers.
