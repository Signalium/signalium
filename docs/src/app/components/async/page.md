---
title: Async components & Suspense
---

Signalium treats async as a first-class concern. Mark a reactive function `async` and it returns a **reactive promise** — a promise-like value that's memoized, deduped, and Suspense-ready. Mark a component `async` and you can `await` reactive promises directly in the render.

```tsx
import { Suspense } from 'react';
import { reactive } from 'signalium';
import { component } from 'signalium/react';

const loadUser = reactive(async (id: string) => {
  const res = await fetch(`/api/users/${id}`);
  return res.json();
});

const Profile = component(async ({ id }: { id: string }) => {
  const user = await loadUser(id);
  return <h1>{user.name}</h1>;
});

export default function App() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <Profile id="42" />
    </Suspense>
  );
}
```

{% callout title="Requires the Babel preset" %}
Async components and async `reactive(...)` functions need the [Signalium Babel preset](/integrating/bundlers) enabled. The preset compiles `await` inside reactive contexts into Suspense-friendly generators so dependency tracking still works across the `await` boundary.
{% /callout %}

## Two ways to consume async data

### 1. Explicit states

If you don't want to use Suspense, or you want fine-grained control over loading UI, read the state properties directly. No async component, no transform — just a plain component that reads a reactive promise:

```tsx
const UserCard = component(({ id }: { id: string }) => {
  const user = loadUser(id); // returns a ReactivePromise, not awaited

  if (user.isPending) return <Spinner />;
  if (user.isRejected) return <Error error={user.error} />;

  return <h1>{user.value!.name}</h1>;
});
```

Every reactive promise exposes:

- `isPending` — promise hasn't settled yet
- `isResolved` / `isRejected` — it settled successfully or failed
- `isReady` — the value is available (even if a new fetch is in flight)
- `isSettled` — any terminal state
- `.value` — the resolved value (or `undefined`)
- `.error` — the rejection reason (or `undefined`)

### 2. `async` components with Suspense

With the preset, you can use real `await`:

```tsx
const Profile = component(async ({ id }: { id: string }) => {
  const user = await loadUser(id);
  return <h1>{user.name}</h1>;
});
```

Wrap in `<Suspense>`. When `loadUser(id)` is pending, React shows the fallback. When it resolves, the component continues from the `await` and renders normally.

## Memoization and deduplication

Reactive async functions are memoized like any other reactive function: by argument shape. Calling `loadUser('42')` from three places in your tree only fetches once.

```tsx
const Header = component(() => {
  const user = loadUser('42'); // one subscription
  return <span>{user.value?.name ?? '…'}</span>;
});

const Sidebar = component(() => {
  const user = loadUser('42'); // hits the same cache entry
  return <img src={user.value?.avatar} />;
});
```

Both components share the same promise. When it settles, both re-render.

## Reactive refetching

Because async reactive functions subscribe to the signals they read, mutating those signals triggers a refetch automatically.

```tsx
const userId = signal('42');
const loadUser = reactive(async () => {
  const res = await fetch(`/api/users/${userId.value}`);
  return res.json();
});

// Later, from anywhere:
userId.value = '99'; // loadUser refetches, all consumers re-render
```

Combine with arguments if you want per-id caching:

```tsx
const loadUser = reactive(async (id: string) => {
  const res = await fetch(`/api/users/${id}`);
  return res.json();
});

loadUser('42'); // fetches and caches '42'
loadUser('99'); // fetches and caches '99' — independent cache
```

## Eager vs lazy updates

The mental model is close to React Transitions + Suspense:

- **Eager replays.** When a React update is triggered by local state (`useState`) or props, the component body runs again from the top on React's normal schedule. Everything *before* the next pending `await` executes synchronously. High-priority UI (counters, form fields, chrome around a loading region) stays responsive.
- **Lazy continuation.** When execution hits an `await` whose reactive promise is still pending, it behaves like `use(promise)`: the render is interrupted, Suspense can show a fallback, and code *after* the `await` runs only after the async work settles and React retries.

So: ordinary React updates rerun the component eagerly up to the next async boundary, while async reactives control how far each pass gets before handing off to Suspense. Durable values still belong in signals, React state, or module-level reactives — not in `let` bindings between `await`s, which replay fresh each attempt.

## Works with `use(...)`

Reactive promises implement the `Promise` interface, so they work with React's `use(...)` from regular (non-`component`) functions:

```tsx
import { use } from 'react';

function RegularProfile({ id }: { id: string }) {
  const user = use(loadUser(id));
  return <h1>{user.name}</h1>;
}
```

## Works with React Server Components

Reactive promises work on the server too. A reactive function defined in a shared file can be `await`ed on the server and `use`d or `await`ed on the client:

```tsx
// lib/query.ts
import { reactive } from 'signalium';

export const getData = reactive(async () => {
  await new Promise((r) => setTimeout(r, 1000));
  return 'Hello, world';
});
```

```tsx
// app/ServerData.tsx
import { getData } from '@/lib/query';
export async function ServerData() {
  const data = await getData();
  return <p>{data}</p>;
}
```

```tsx
// app/ClientData.tsx
'use client';
import { use } from 'react';
import { component } from 'signalium/react';
import { getData } from '@/lib/query';

export const ClientData = component(() => {
  const data = use(getData());
  return <p>{data}</p>;
});
```

See [RSC & SSR](/integrating/rsc-ssr) for the current caveats (request-scoped caches, `use client;` boundaries).

## Triggering async work from events

For async work that's *caused* by a user action rather than a render, use [`task(...)`](/api/signalium#task):

```tsx
import { task, reactive } from 'signalium';
import { component } from 'signalium/react';

const updateUserTaskFor = reactive((id: string) =>
  task(async () => {
    const res = await fetch(`/api/users/${id}`, { method: 'PATCH' });
    return res.json();
  }),
);

const User = component(({ id }: { id: string }) => {
  const update = updateUserTaskFor(id);

  return (
    <div>
      <button onClick={() => update.run()}>Save</button>
      {update.isPending && <Spinner />}
      {update.error && <Error error={update.error} />}
    </div>
  );
});
```

Tasks give you a handle with `.run()`, `.isPending`, `.error`, `.value` — no intermediate signal needed to hold the promise.

## Next steps

- [Reactive promises](/reactivity/reactive-promises) — the full reference on state machines, settlement, composition.
- [`useReactive`](/integrating/use-reactive) — how to read reactive promises from non-`component` functions.
