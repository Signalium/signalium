---
title: State libraries
---

Signalium does not replace your state library. It coexists with Redux, Zustand, TanStack Query, MobX, Jotai, or anything else that implements a reasonable subscribe/snapshot interface. You can adopt signals alongside your existing store, migrate a slice at a time, or stay mixed forever.

This page covers practical interop patterns for the three most common stacks: **Redux**, **Zustand**, and **TanStack Query**. The same principles generalize to any other store library.

## General strategies

Three patterns cover almost every case:

1. **Read the external store from inside a `component(...)`.** Just use whatever hook the library ships (`useSelector`, `useStore`, `useQuery`). The component renders through React's normal path; Signalium's fine-grained reactivity handles the signal reads alongside. This is the no-migration path.

2. **Mirror a slice into a signal.** Wrap the external store in a module-scoped signal that updates from the store's subscribe callback. Code that reads the signal doesn't care whether the source of truth is Redux or a Signalium signal.

3. **Replace a slice with a signal.** For pieces of state that don't need to be in Redux/Zustand for any structural reason (devtools, middleware, time-travel), just move them to a plain signal.

Pick whichever makes sense for the situation. Mixed is fine.

## Redux

### Pattern 1: Use `useSelector` inside a `component(...)`

`component(...)` is just a React function component, so `useSelector` works unmodified:

```tsx
import { useSelector } from 'react-redux';
import { component, useSignal } from 'signalium/react';

export const Cart = component(() => {
  const items = useSelector((s: RootState) => s.cart.items);
  const coupon = useSignal('');

  return (
    <div>
      <ul>
        {items.map((i) => (
          <li key={i.id}>{i.name}</li>
        ))}
      </ul>
      <input
        value={coupon.value}
        onChange={(e) => (coupon.value = e.target.value)}
      />
    </div>
  );
});
```

`useSelector` is a hook; rules of hooks apply. The component re-renders when Redux's selector fires *or* when any signal it reads updates — both drive React the same way. No bridging, no extra providers.

### Pattern 2: Mirror a Redux slice into a signal

If you want reactive functions to read Redux state, mirror the slice into a signal:

```ts
// app/state/redux-signals.ts
import { signal } from 'signalium';
import { store } from './store';

export const cartItems = signal(store.getState().cart.items);

store.subscribe(() => {
  const next = store.getState().cart.items;
  if (next !== cartItems.value) {
    cartItems.value = next;
  }
});
```

Now any `reactive(...)` function can read `cartItems.value`, and components can consume the signal directly:

```ts
import { reactive } from 'signalium';
import { cartItems } from './redux-signals';

export const cartTotal = reactive(() =>
  cartItems.value.reduce((sum, i) => sum + i.price * i.quantity, 0),
);
```

```tsx
import { component } from 'signalium/react';
import { cartTotal } from './redux-signals';

export const CartTotal = component(() => <span>${cartTotal()}</span>);
```

The identity check (`next !== cartItems.value`) is important — Redux fires subscribers on every dispatch, not just ones that change the slice you care about. Use a shallow equality check if the slice is a freshly-constructed object each dispatch.

### Pattern 3: Migrate a slice off Redux

If the slice has no reducer, no middleware, and no devtools requirement, move it off Redux:

```ts
// Before: src/store/ui.ts (Redux slice)
export const uiSlice = createSlice({
  name: 'ui',
  initialState: { sidebarOpen: false, modalStack: [] as string[] },
  reducers: {
    toggleSidebar: (s) => { s.sidebarOpen = !s.sidebarOpen; },
    pushModal: (s, a: PayloadAction<string>) => { s.modalStack.push(a.payload); },
    popModal: (s) => { s.modalStack.pop(); },
  },
});
```

```ts
// After: src/state/ui.ts (Signalium)
import { signal } from 'signalium';

export const sidebarOpen = signal(false);
export const modalStack = signal<string[]>([]);

export const toggleSidebar = () => { sidebarOpen.value = !sidebarOpen.value; };
export const pushModal = (name: string) => { modalStack.value = [...modalStack.value, name]; };
export const popModal = () => { modalStack.value = modalStack.value.slice(0, -1); };
```

The callers change from `useSelector`/`useDispatch` to `component(...)` + direct reads. If any code still uses the Redux slice, mirror back for a transition period (pattern 1 in reverse — write a signal-to-Redux bridge) until every caller is migrated.

## Zustand

Zustand is the easiest interop target because its API is close to Signalium's already — a store with a `subscribe` and a `getState`.

### Pattern 1: Use `useStore` inside a `component(...)`

```tsx
import { create } from 'zustand';
import { component, useSignal } from 'signalium/react';

const useStore = create<{ count: number; increment: () => void }>((set) => ({
  count: 0,
  increment: () => set((s) => ({ count: s.count + 1 })),
}));

export const Counter = component(() => {
  const count = useStore((s) => s.count);
  const note = useSignal('');

  return (
    <div>
      <p>{count}</p>
      <button onClick={() => useStore.getState().increment()}>+</button>
      <input
        value={note.value}
        onChange={(e) => (note.value = e.target.value)}
      />
    </div>
  );
});
```

`useStore` is a hook; it works inside `component(...)` exactly like in any other React component.

### Pattern 2: Mirror a Zustand store into a signal

```ts
// app/state/zustand-signals.ts
import { signal } from 'signalium';
import { useCountStore } from './store';

export const count = signal(useCountStore.getState().count);

useCountStore.subscribe((s) => {
  if (s.count !== count.value) {
    count.value = s.count;
  }
});
```

Now reactive functions and non-component code can read `count.value` without touching Zustand.

### Pattern 3: Replace a Zustand store with signals

Zustand stores often map cleanly onto a small collection of signals:

```ts
// Before
const useCountStore = create<{ count: number; double: number }>((set, get) => ({
  count: 0,
  get double() { return get().count * 2; },
  increment: () => set((s) => ({ count: s.count + 1 })),
}));
```

```ts
// After
import { signal, reactive } from 'signalium';

export const count = signal(0);
export const doubled = reactive(() => count.value * 2);
export const increment = () => { count.value++; };
```

Consumers change from `useCountStore((s) => s.count)` to `count.value` (or the signal directly passed around). `doubled` replaces Zustand's derived getter.

## TanStack Query

TanStack Query (React Query) is a cache with first-class Suspense, retries, and query invalidation. Signalium's reactive promises cover the "async function that memoizes and re-runs on dep change" use case, but TanStack Query has a much richer feature set (stale-while-revalidate, query invalidation graphs, persistence, devtools). Most apps keep both.

### Pattern 1: Use `useQuery` inside a `component(...)`

`useQuery` is a hook; it works inside `component(...)` unchanged:

```tsx
import { useQuery } from '@tanstack/react-query';
import { component, useSignal } from 'signalium/react';

export const UserCard = component(({ id }: { id: string }) => {
  const { data, isLoading } = useQuery({
    queryKey: ['user', id],
    queryFn: () => fetch(`/api/users/${id}`).then((r) => r.json()),
  });

  if (isLoading) return <p>Loading…</p>;
  return <p>{data.name}</p>;
});
```

### Pattern 2: Replace a one-off query with `reactive(async ...)`

For a query that doesn't need TanStack Query's advanced features, `reactive(async ...)` is simpler — no provider, no query key, memoization by argument identity:

```ts
import { reactive } from 'signalium';

export const loadUser = reactive(async (id: string) => {
  const res = await fetch(`/api/users/${id}`);
  return res.json();
});
```

```tsx
import { component } from 'signalium/react';
import { use } from 'react';
import { loadUser } from './queries';

export const UserCard = component(({ id }: { id: string }) => {
  const user = use(loadUser(id));
  return <p>{user.name}</p>;
});
```

One function, one import, one usage. See [Reactive promises](/reactivity/reactive-promises) and [RSC & SSR](/integrating/rsc-ssr) for the full story.

### Pattern 3: Combine — TanStack Query for the network layer, signals for the UI

A common hybrid: TanStack Query caches fetches and handles retries, but the UI state (filters, sort, selected tab) lives in signals:

```tsx
import { useQuery } from '@tanstack/react-query';
import { component, useSignal } from 'signalium/react';
import { reactive } from 'signalium';

export const UserList = component(() => {
  const sortBy = useSignal<'name' | 'joined'>('name');
  const filter = useSignal('');

  const { data } = useQuery({
    queryKey: ['users'],
    queryFn: () => fetch('/api/users').then((r) => r.json()),
  });

  const filtered = reactive(() => {
    if (!data) return [];
    return data
      .filter((u: User) => u.name.toLowerCase().includes(filter.value.toLowerCase()))
      .sort((a: User, b: User) => a[sortBy.value].localeCompare(b[sortBy.value]));
  });

  return (
    <div>
      <input
        value={filter.value}
        onChange={(e) => (filter.value = e.target.value)}
      />
      <select
        value={sortBy.value}
        onChange={(e) => (sortBy.value = e.target.value as 'name' | 'joined')}
      >
        <option value="name">Name</option>
        <option value="joined">Joined</option>
      </select>
      <ul>{filtered().map((u) => <li key={u.id}>{u.name}</li>)}</ul>
    </div>
  );
});
```

`useQuery` handles the HTTP caching; signals handle the UI knobs. `reactive(...)` derives the filtered list from both. Each layer does what it's best at.

### Pattern 4: Feed a TanStack query into a signal

If you want `reactive(...)` functions to see query results, bridge the query into a signal via a custom hook:

```tsx
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { component, useSignal } from 'signalium/react';

export function useQuerySignal<T>(key: unknown[], fn: () => Promise<T>) {
  const result = useSignal<T | undefined>(undefined);
  const q = useQuery({ queryKey: key, queryFn: fn });

  useEffect(() => {
    if (q.data !== undefined) result.value = q.data;
  }, [q.data]);

  return result;
}
```

Then you can pass the signal to reactive functions that consume it. For a non-hook, fully reactive version, consider wrapping TanStack Query's imperative client in a [relay](/reactivity/relays).

## MobX, Jotai, others

The same three patterns work for anything with a subscribe/snapshot interface:

- **MobX:** read MobX observables inside a `component(...)` via `observer` from `mobx-react-lite`. Or mirror a MobX observable into a signal with `autorun`.
- **Jotai:** read atoms inside a `component(...)` via `useAtom` / `useAtomValue`. Or mirror an atom into a signal via `store.sub`.
- **XState:** `useMachine` works inside `component(...)` unchanged. For reactive-function access, mirror the machine's state with `machine.subscribe`.

The common shape:

```ts
import { signal } from 'signalium';
import { someExternalStore } from './external';

export const mirrored = signal(someExternalStore.getSnapshot());

someExternalStore.subscribe(() => {
  const next = someExternalStore.getSnapshot();
  if (next !== mirrored.value) mirrored.value = next;
});
```

One subscribe, one update, identity check to avoid needless notifications. Reactive functions downstream don't know or care.

## Opinionated guidance

- **Don't mirror unnecessarily.** If only React components read the state, using the library's hook inside `component(...)` is enough. Mirroring is for when *reactive functions* need to read it.
- **Don't migrate slices that are doing work for you.** Redux's devtools, middleware, and time-travel are genuinely useful. Signals are better for state that exists purely for rendering.
- **Module-scoped signals replace most of Zustand.** If you reached for Zustand because Redux felt heavy, a handful of module-level signals likely does the job with less ceremony.
- **Keep TanStack Query for the network layer.** Cache invalidation, retries, and stale-while-revalidate are the value-add. `reactive(async ...)` is great for one-off queries but doesn't replace a caching layer.

## Next steps

- [Incremental adoption](/integrating/existing-apps) — patterns for introducing signals into an existing app without ripping out your state library.
- [Reactive promises](/reactivity/reactive-promises) — the full story on `reactive(async ...)`.
- [Relays](/reactivity/relays) — the right primitive for bridging external subscription APIs into the reactive graph.
- [Testing](/integrating/testing) — testing hybrid stacks.
