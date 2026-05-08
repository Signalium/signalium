---
title: RSC & SSR
---

Signalium's core package works anywhere JavaScript does — Node, workers, edge runtimes, and the browser. That means the same reactive functions you use on the client can run on the server, including inside React Server Components and SSR. The integration is deliberately minimal: there's no special "server entry point" and no separate build for RSC.

That said, the React bindings (`signalium/react`) were designed for the browser first, and some pieces of the story — notably request-scoped caching — are still in flight. This page covers what works today, the patterns we recommend, and the caveats to keep in mind.

## What works on the server today

- Importing from `signalium` (core): `signal`, `reactive`, `relay`, `context`, `getContext`, `withContexts`, `task`, `watcher`, `notifier`, `reactiveMethod`.
- `await`ing a reactive promise: an async `reactive(...)` call produces a promise you can `await` in a server component.
- Calling `reactive(...)` functions from the server synchronously — they run once and return the computed value.
- Using signals as plain values inside server rendering. Reactivity is a no-op on the server because nothing subscribes after the render completes.

## What's client-only today

- `signalium/react`'s hooks (`useSignal`, `useReactive`, `useContext`) assume an active React renderer in a client environment. They work fine in a Node SSR pass for *client* components (because those are still React client rendering, just in Node), but they cannot be imported into a server component file.
- `ContextProvider` and `PauseSignalsProvider` are client components.

The React bindings are currently published without `"use client"` pragmas in the source, which lets the bundler treat them as generic client modules. See the caveats below for what that means in Next.js and similar frameworks.

## Reactive functions on the server

A plain async `reactive(...)` call can be used anywhere you'd use a plain async function on the server. The server component just `await`s it:

```ts
// app/lib/data.ts
import { reactive } from 'signalium';

export const loadUser = reactive(async (id: string) => {
  const res = await fetch(`https://api.example.com/users/${id}`, {
    // next.js-specific fetch options are still honored here
    next: { revalidate: 60 },
  });
  return res.json();
});
```

```tsx
// app/users/[id]/page.tsx (server component)
import { loadUser } from '@/lib/data';

export default async function Page({ params }: { params: { id: string } }) {
  const user = await loadUser(params.id);
  return <h1>{user.name}</h1>;
}
```

On the server, `await loadUser(id)` is a normal promise await — the reactive machinery still runs (argument hashing, memoization, context lookup), but nothing subscribes because there's no rerunning reactive consumer on the server.

## Using the same reactive function on the client

The same `loadUser` can be imported into a client component. From the client, you want the *reactive* behavior — the component should suspend until the promise resolves and re-render on future state transitions.

You have two main ways to do this:

### Option A: `component(async (props) => { await ... })`

With the [Signalium Babel preset](/guides/code-transforms), you can write an async component and `await` the reactive function directly. The preset rewrites the async component into a form that integrates with Suspense:

```tsx
// app/ui/user-card.tsx
import { Suspense } from 'react';
import { component } from 'signalium/react';
import { loadUser } from '@/lib/data';

export const UserCard = component(async ({ id }: { id: string }) => {
  const user = await loadUser(id);
  return <div>{user.name}</div>;
});

// Usage
<Suspense fallback={<div>Loading…</div>}>
  <UserCard id={userId} />
</Suspense>;
```

### Option B: `use(promise)` from React

If you're not using the Babel preset, wrap the call in `use(...)`:

```tsx
import { use } from 'react';
import { component } from 'signalium/react';
import { loadUser } from '@/lib/data';

export const UserCard = component(({ id }: { id: string }) => {
  const user = use(loadUser(id));
  return <div>{user.name}</div>;
});
```

A reactive promise implements the standard `Promise` interface, so `use` works on it the same as any other thenable. The only difference is that the same promise instance is returned on subsequent calls with the same arguments, so React's `use` dedupes cleanly.

### Option C: explicit state

If you want to render loading states yourself:

```tsx
import { useReactive } from 'signalium/react';

function UserCard({ id }: { id: string }) {
  const user = useReactive(() => loadUser(id));
  if (user.isPending) return <p>Loading…</p>;
  if (user.isRejected) return <p>Error: {String(user.error)}</p>;
  return <p>{user.value.name}</p>;
}
```

Use this when you don't want Suspense to handle the loading state (e.g. for an inline "not critical" widget).

## The same code, both sides

Because reactive functions work on the server and the client, a single data-loading function can serve both:

```tsx
// app/lib/query.ts
import { reactive } from 'signalium';

export const getData = reactive(async () => {
  const res = await fetch('https://api.example.com/data');
  return res.json();
});
```

```tsx
// app/page.tsx (server component)
import { Suspense } from 'react';
import { getData } from '@/lib/query';
import { ClientData } from './ui/client-data';

export default async function Page() {
  const initial = await getData();
  return (
    <Suspense fallback={<div>…</div>}>
      <h1>{initial.title}</h1>
      <ClientData />
    </Suspense>
  );
}
```

```tsx
// app/ui/client-data.tsx ("use client")
'use client';
import { use } from 'react';
import { component } from 'signalium/react';
import { getData } from '@/lib/query';

export const ClientData = component(() => {
  const data = use(getData());
  return <p>{data.detail}</p>;
});
```

The server calls `getData()` directly; the client calls it through `component(...)` with `use(...)` for Suspense integration. Same function, same memoization key, different rendering modes.

## SSR of client components

Next.js and similar frameworks render client components in a separate SSR pass (a Node pass that emits HTML for client components, distinct from the RSC pass). Signalium's React bindings handle this automatically: a `React.cache`-backed `SignalScope` is installed per SSR render, so each request gets a fresh reactive scope on the server side. That means:

- Signals you read inside a client component during SSR reflect per-request values, not shared globals.
- `ContextProvider` wrapped around the app provides context values to the SSR pass cleanly.

This works out of the box — no configuration required. The scope is set up the first time a `component(...)` is defined or `ensureSsrScope` runs, using `React.cache` to scope it to the current request.

## Caveats

### Shared caches across requests

Reactive functions deduplicate results by default, keyed by their argument list. On a long-lived server process, that means:

- Module-scoped `reactive(...)` functions *can* share state across requests. If you write `reactive(async () => fetch(...))`, every request hits the same cache. This is fine for static content; it's a footgun for request-scoped data.
- For anything request-scoped (authenticated fetches, per-user state), don't rely on reactive deduplication. Use one of the patterns below.

### Pattern: inject a client via context

The cleanest way to keep per-request state isolated is to pass a client instance through a Signalium context. The reactive function closes over the context lookup, so different requests with different contexts see different clients and caches:

```ts
// app/lib/api.ts
import { context, getContext, reactive } from 'signalium';

export interface ApiClient {
  fetchJSON(path: string): Promise<unknown>;
}

export const ApiCtx = context<ApiClient | null>(null);

export const loadUser = reactive(async (id: string) => {
  const api = getContext(ApiCtx);
  if (!api) throw new Error('ApiClient not provided');
  return api.fetchJSON(`/users/${id}`);
});
```

On the server, construct a fresh client per request and wrap the render in a provider:

```tsx
// app/layout.tsx (client component boundary)
'use client';
import { ContextProvider } from 'signalium/react';
import { ApiCtx } from '@/lib/api';

export function AppProviders({
  client,
  children,
}: {
  client: ApiClient;
  children: React.ReactNode;
}) {
  return (
    <ContextProvider contexts={[[ApiCtx, client]]}>
      {children}
    </ContextProvider>
  );
}
```

The outer server layout can build the client (possibly using request-scoped data like cookies or headers) and pass it in. Reactive functions that read `ApiCtx` will now see the right client for each request.

### Pattern: useState-driven signals

For smaller cases where you don't need full context, you can lift a signal into a `component(...)` via `useSignal` and pass it into reactive functions as a parameter. Each component instance gets its own signal, so reactive functions parameterized by that signal don't share cache entries with other instances:

```tsx
import { component, useSignal } from 'signalium/react';
import { reactive, Signal } from 'signalium';

const search = reactive(async (query: Signal<string>) => {
  const res = await fetch(`/api/search?q=${query.value}`);
  return res.json();
});

export const SearchBox = component(() => {
  const query = useSignal('');
  const results = search(query);

  return (
    <div>
      <input
        value={query.value}
        onChange={(e) => (query.value = e.target.value)}
      />
      <pre>{JSON.stringify(results.value)}</pre>
    </div>
  );
});
```

Each render of `<SearchBox />` has its own `query` signal, so the `search(query)` call caches per-instance. This is request-scoped "for free" — since the signal is component-local, it can't leak to another SSR render.

### Client-only React bindings

At time of writing, `signalium/react` is not safe to import into a server component (`.tsx` files without `"use client"`). In Next.js, this means any file that imports from `signalium/react` should have `"use client"` at the top, or be imported by a file that does.

A server-side split is on the roadmap. The plan is to publish separate exports for `signalium/react` server helpers and use conditional exports to pick the right bundle per environment. Until then:

- Server components: import from `signalium` only.
- Client components: import from both `signalium` and `signalium/react`.
- Shared reactive functions: keep them in a `.ts` file that doesn't import anything from `signalium/react` so both environments can consume it.

## Streaming and Suspense boundaries

Reactive promises work with Suspense streaming the same way as any other promise. An async `component(...)` that awaits a reactive function will suspend its subtree until the promise resolves, and Next.js (or any framework with streaming support) will stream the HTML fragment as soon as it's ready.

```tsx
import { Suspense } from 'react';
import { component } from 'signalium/react';
import { loadDashboard } from '@/lib/data';

export const Dashboard = component(async () => {
  const data = await loadDashboard();
  return (
    <div>
      <h1>{data.title}</h1>
      <Suspense fallback={<WidgetsSkeleton />}>
        <Widgets />
      </Suspense>
    </div>
  );
});
```

Each `<Suspense>` boundary flushes independently. Nothing about reactive promises is special here — they just slot into React's existing streaming model.

## Honest limitations

- **Request-scoped caches are a manual pattern right now.** We recommend the context-based injection pattern above. The roadmap has an opt-in "request scope" that will automatically use `React.cache` to dedupe per-request; until it lands, assume module-level `reactive(async ...)` is request-shared.
- **`signalium/react` is client-first.** Server helpers are planned but not shipped. Don't import it into server components.
- **Relays on the server are not auto-torn-down.** A `relay(...)` that opens a subscription (WebSocket, SSE, interval) will not clean itself up if you accidentally call it on the server. Keep relay usage to client components.
- **React Compiler compatibility.** Server components rendered through the React Compiler interoperate fine with reactive functions, because `reactive(...)` doesn't depend on React's render machinery — it's just a memoized function at that layer.

## Next steps

- [Reactive promises](/reactivity/reactive-promises) — how `await` and `use(...)` behave on reactive async results.
- [Contexts](/reactivity/contexts) — the full reference for `context`, `getContext`, and `withContexts`.
- [Testing](/integrating/testing) — injecting per-request clients in tests mirrors the pattern above.
- [Code transforms & async context](/guides/code-transforms) — the Babel preset that enables `component(async ...)`.
