---
title: Derived values with reactive
---

`reactive(...)` is how you derive values. It wraps a function so that its result is cached, re-run only when its actual dependencies change, and automatically tracked when called from a `component`.

```tsx
import { reactive } from 'signalium';
import { component, useSignal } from 'signalium/react';

const Counter = component(() => {
  const count = useSignal(0);
  const doubled = reactive(() => count.value * 2);

  return (
    <div>
      <p>{count.value} × 2 = {doubled()}</p>
      <button onClick={() => count.value++}>+</button>
    </div>
  );
});
```

If `useSignal` is "the new `useState`", `reactive` is "the new `useMemo`" — except with no dependency array and no rules-of-hooks restriction.

## The whole value proposition

```tsx
// Before
const fullName = useMemo(
  () => `${firstName} ${lastName}`,
  [firstName, lastName], // typo here and you get stale data
);

// After
const fullName = reactive(() => `${firstName.value} ${lastName.value}`);
```

Signalium tracks the dependencies for you. Reads of `firstName.value` and `lastName.value` inside the function are captured at call time. If either changes, the cached result is invalidated and the function re-runs the next time it's called.

## Calling a reactive function

```tsx
const doubled = reactive(() => count.value * 2);

// Inside a component:
doubled();       // returns the cached or freshly computed value
doubled();       // returns the cached value (no recomputation)
count.value++;
doubled();       // re-runs and returns the new value
```

The parentheses are intentional: `reactive` returns a function. Calling it consults the cache. If nothing it depends on has changed since the last call, you get the cached result. If anything did, it re-runs.

## Arguments

Reactive functions can take arguments. They memoize on argument shape:

```tsx
const power = reactive((base: number, exp: number) => {
  return Math.pow(base, exp);
});

power(2, 8); // computes 256
power(2, 8); // cached, returns 256
power(3, 2); // separate cache entry, computes 9
```

Arguments are compared semi-deeply (same rules as component props). If you pass a plain object or array with the same shape, you hit the cache.

## Passing signals as arguments

A common pattern — pass signals instead of their `.value`s. The reactive function subscribes once and can be called repeatedly without creating new cache entries:

```tsx
const formatName = reactive((first: Signal<string>, last: Signal<string>) => {
  return `${first.value} ${last.value}`;
});

const Profile = component(() => {
  const first = useSignal('Ada');
  const last = useSignal('Lovelace');

  return <p>{formatName(first, last)}</p>;
});
```

Because `first` and `last` are stable signal references, `formatName(first, last)` always hits the same cache entry. When either signal updates, the function re-runs — but *only* because the signal changed, not because of a new argument.

This pattern becomes important when reactive functions are composed:

```tsx
const formatName = reactive((first: Signal<string>, last: Signal<string>) =>
  `${first.value} ${last.value}`);

const greeting = reactive(
  (prefix: Signal<string>, first: Signal<string>, last: Signal<string>) =>
    `${prefix.value} ${formatName(first, last)}`,
);

const card = reactive(
  (title: Signal<string>, prefix: Signal<string>, first: Signal<string>, last: Signal<string>) =>
    `[${title.value}] ${greeting(prefix, first, last)}`,
);
```

When `first` changes:
- `formatName` re-runs.
- If its result changed, `greeting` re-runs.
- If *its* result changed, `card` re-runs.

If any of those returns structurally equal output, propagation stops. You only pay for what actually changed.

## Declaring reactive functions

You can declare reactive functions anywhere:

**At module scope** — best for pure derivations that don't depend on component-local signals:

```ts
const activeUser = signal<User | null>(null);
const displayName = reactive(() =>
  activeUser.value?.name ?? 'Anonymous');
```

**Inside a component** — for derivations that close over component state:

```tsx
const Counter = component(() => {
  const count = useSignal(0);
  const doubled = reactive(() => count.value * 2);
  return <p>{doubled()}</p>;
});
```

Declaring inside a component is cheap — Signalium reuses the same reactive function across renders, as long as the component isn't unmounted.

**As class methods (with `reactiveMethod`)** — for computations tied to an object instance. See the [API reference](/api/signalium#reactivemethod) for details.

## What reactive functions *can't* do

- **No hooks.** `useState`, `useSignal`, `useEffect`, etc. cannot be called inside a `reactive(...)`. Hooks are tied to React's render cycle; reactive functions run on their own schedule.
- **No creating state signals inside.** Don't call `signal(...)` inside a reactive function body — the signal would be created fresh on every run. Signals belong at module scope, in a class, or in `useSignal` inside a component.
- **No side effects.** Reactive functions are supposed to be pure. If you need a side effect, use a relay, a watcher, or a `useEffect`.

If you need any of those, you're probably looking for a [relay](/reactivity/relays), a [watcher](/reactivity/watchers), or plain React state.

## Common patterns

### Replacing `useMemo`

```tsx
// Before
const filtered = useMemo(
  () => items.filter(i => i.status === status),
  [items, status],
);

// After
const items = useSignal<Item[]>([]);
const status = useSignal<Status>('active');
const filtered = reactive(() =>
  items.value.filter(i => i.status === status.value));

return <List items={filtered()} />;
```

### Replacing derived state in context providers

Context providers are frequently used just to avoid re-render cascades. Signalium doesn't need that workaround:

```ts
// counter-store.ts
import { signal, reactive } from 'signalium';

export const count = signal(0);
export const doubled = reactive(() => count.value * 2);
export const isEven = reactive(() => count.value % 2 === 0);
```

```tsx
// anywhere
const Label = component(() => {
  return <p>{doubled()} ({isEven() ? 'even' : 'odd'})</p>;
});
```

No provider. No selector. Just values.

## Next steps

- [Async components & Suspense](/components/async) — reactive functions also work with `async`/`await`.
- [Reactive functions](/reactivity/reactive-functions) — the full reference on how reactive functions track dependencies, memoize, and compose.
