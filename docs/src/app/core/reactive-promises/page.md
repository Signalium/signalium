---
title: Reactive Promises
nextjs:
  metadata:
    title: Reactive Promises
    description: Working with Reactive Promises in Signalium
---

Normal Reactive Functions cover all use cases for _synchronous_ computation, but what about _asynchronous_ computation?

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

To understand Reactive Promises, the first thing to consider is: what does it mean to _react_ to a promise?

Promises are based on an _imperative_ mental model. "Do _this_, wait, _then_ do this." The imperative way of thinking about loading data would be something like:

1. Update the UI to show a loading spinner
2. Fetch the data and wait for it to return
3. Update the UI to hide the loading spinner and display the data

However, we want a _declarative_ way of representing this data, one that derives directly from our state. This way of thinking looks more like:

1. When we are loading data, show the loading spinner
2. When we have data, show the rendered data

The way Signalium handles this is by exposing the various states of a Promise as properties:

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

Whenever a Reactive Function returns a Promise, Signalium converts that Promise into a Reactive Promise with these properties.

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

- `value`: The most recent result of the Promise. This will remain the latest result until the next successful rerun of the Promise, allowing you to show the previous state while the next state is loading.
- `error`: The most recent error of the Promise. This will remain the latest error until the next run, allowing you to show the current error state.
- `isPending`: True when the Reactive Promise is currently running (e.g. the Promise has not yet resolved).
- `isResolved`: True when the Reactive Promise resolved successfully.
- `isRejected`: True when the Reactive Promise rejected.
- `isSettled`: True if the Reactive Promise has settled at least _once_.
- `isReady`: True when the Reactive Promise has resolved at least _once_.

This mirrors popular libraries such as [TanStack Query](https://tanstack.com/query/latest) and [SWR](https://github.com/vercel/swr) among many others. However, Reactive Promises have some additional niceties.

### Awaiting results

In addition to the declarative properties, you can also _await_ Reactive Promises using standard async/await syntax:

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

Execution pauses when values are awaited until the Promise settles (resolves or rejects). This guarantees a value or an error before proceeding, eliminating the need for `undefined` checks and simplifying state management.

### Promise composition

You can compose Promises using the standard Promise methods like `Promise.all`, `Promise.race`, etc.

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

This allows you to chain Reactive Promises together and ensure that all promises are settled before continuing the computation, and it allows you to do so with familiar APIs that users already know and understand.

### Handling errors

You can also handle errors using the semantics of standard `try/catch` syntax in async Reactive Functions:

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

Reactive Promises are meant to represent _data_, values fetched or generated based on some input (e.g. a URL). In many cases, however, we have an _asynchronous task_ which triggers based on some action or event. For example, you might have a save button that sends a `PATCH` request to the server. You _could_ just handle that in an event handler and not bother with hooks or signals, but you'll likely want to show a loading spinner, or some other indicator that the action is happening.

You can do this with standard async Reactive Functions, but you have to store the result of the function, the promise representing the task, in a signal if you want to use its properties:

```ts
import { signal, reactive } from 'signalium';
import { component } from 'signalium/react';

const updateUser = reactive(async (id: string) => {
  const res = await fetch(`/api/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: 'Tony Stark' }),
  });

  return res.json() as Promise<{ id: string; name: string }>;
});

const UserUpdater = component(({ id }: { id: string }) => {
  // Have to create a signal to hold the promise
  const updatePromise = signal<
    ReactivePromise<{ id: string; name: string }> | undefined
  >();

  return (
    <div>
      {/* Assign the promise to the signal */}
      <button onClick={() => (updatePromise.value = updateUser(id))}>
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
```

You can create a special kind of Reactive Promise directly to handle this, a _Reactive Task_. Reactive Tasks are kind of like a _placeholder_ for a Reactive Promise that you can run manually using the `run()` method. This allows you define a Reactive Task in your component so you can read its current state, and then run it whenever you need to in response to some event or user input. The state of the task will be automatically updated as it runs, allowing you to render loading states, errors, and results dynamically.

```ts
import { signal, reactive, task } from 'signalium';
import { component } from 'signalium/react';

const updateUserTaskFor = reactive((id: string) => {
  return task(async () => {
    const res = await fetch(`/api/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Tony Stark' }),
    });

    return res.json() as Promise<{ id: string; name: string }>;
  });
});

const UserTaskUpdater = component(({ id }: { id: string }) => {
  // The task instance is the promise itself
  const updateUserTask = updateUserTaskFor(id);

  return (
    <div>
      {/* We can run the task directly, no need to assign to a signal */}
      <button onClick={() => updateUserTask.run()}>Update User</button>
      {/* We can access properties directly! */}
      {updateUserTask.isPending && <p>Loading…</p>}
      {updateUserTask.error && <p>Error</p>}
      {updateUserTask.isReady && <p>{updateUserTask.value.name}</p>}
    </div>
  );
});
```

### Passing parameters to Tasks

Reactive Tasks can receive parameters when `run` is called as well, so you can reuse a single task instance with different parameters. This is useful if you don't know the parameters ahead of time, or if you want to create a shared task instance rather than recreating new ones each time.

```ts
import { signal, reactive, task } from 'signalium';
import { component } from 'signalium/react';

const updateUserTaskFor = reactive((id: string) => {
  return task(async (name: string) => {
    const res = await fetch(`/api/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    });

    return res.json() as Promise<{ id: string; name: string }>;
  });
});

const UserTaskUpdater = component(({ id }: { id: string }) => {
  // The task instance is the promise itself
  const updateUserTask = updateUserTaskFor(id);
  const name = signal('Tony Stark');

  return (
    <div>
      <input type="text" value={name.value} onChange={(e) => (name.value = e.target.value)} />
      <button onClick={() => updateUserTask.run(name.value)}>Update User</button>
      {updateUserTask.isPending && <p>Loading…</p>}
      {updateUserTask.error && <p>Error</p>}
      {updateUserTask.isReady && <p>{updateUserTask.value.name}</p>}
    </div>
  );
});
```

This allows us to avoid creating a new task on each change to the input, and instead reuse the same task instance with the current value on save.

### Anti-pattern: Running Tasks inside Reactive Functions

One temptation for Reactive Tasks is to run them _in response_ to some other data changing. For instance, you might try to set up something like this:

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

Reactive Tasks are meant to represent a "write" operation of some sort, effectively updating some state elsewhere. And, like [mutating state in a reactive function](/core/signals-and-reactive-functions#mutations-within-reactive-functions), running mutations as a side-effect of running a Reactive Function is generally an antipattern and can violate signal-purity. If you're considering doing this, some alternatives might be:

1. Running the task in an event or user input handler (though if you're here, you've likely considered this already and it's not realistic)
2. Converting the task to an async Reactive Function and deriving from the value instead (again, likely something you've considered, but it's worth checking!)
3. If the task whose _state_ has no impact on the UI, consider making it a plain async function instead of a task. For instance, in the `analytics` example above, there usually isn't a loading spinner or anything like that shown when we're sending analytics data, so there's no reason for that to be a task over a plain function. Likely it would also batch events together and then manage them all in one place, and that could be a global or a contextual value, but there's no reason for it to be a _reactive_ value as well.

Like with updating state, there is no blanket prohibition on running tasks in your Reactive Functions, but it can lead to unexpected and difficult to reason about behavior and _should be avoided_.

## Summary

Reactive Promises (created via async Reactive Functions) and Reactive Tasks are the go-to solutions when dealing with standard, promise-based async in Signalium. To sum up the main points:

- Reactive Promises
  - Superset of standard promises with declarative state for `isPending`, `isResolved`, `value`, etc.
  - Promises returned by Reactive Functions are converted into Reactive Promises
  - Only propagate changes when they are fully resolved
  - Can be awaited with `async`/`await` syntax
  - Can be composed with standard promise methods like `Promise.all`, `Promise.race`, etc.
  - Can be used with `try/catch` syntax to handle errors
- Reactive Tasks
  - Used for running an async operation on command
  - Exposes the same state properties as Reactive Promises
  - Should not be used _reactively_ (e.g. in response to changes in other signals)

Between Reactive Promises and Reactive Tasks, most common data fetching and mutation operations should be covered. This is because _most_ async in JavaScript is _symmetric_ - you send one request, you receive one response.

What do we do, however, when we have to deal with _asymmetric_ async? This brings us to the final core concepts in Signalium: Relays and Watchers.
