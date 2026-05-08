---
title: useReactive & imperative reads
---

`useReactive` is the bridge from a plain React function component into the signal graph. Inside a `component(...)` you never need it — you just read `.value` and call `reactive(...)` functions directly. Outside of a `component(...)`, any React code that wants to subscribe to signals or reactive functions uses `useReactive`.

```tsx
import { useReactive } from 'signalium/react';
import { cartTotal } from '@/state/cart';

function CartBadge() {
  const total = useReactive(() => cartTotal());
  return <span>${total}</span>;
}
```

`CartBadge` is a plain React function component — no `component(...)` wrapper — but it re-renders whenever `cartTotal()` produces a new value.

## Signature

```ts
function useReactive<R>(fn: () => R): ReactiveValue<R>;
function useReactiveShallow<R>(fn: () => R): R;
```

Both take a thunk that reads from the signal graph. The thunk can do anything a reactive consumer does: read `.value`, call `reactive(...)` functions, read contexts via `getContext`, compose derived values.

- **`useReactive`** returns a structurally-shared snapshot of the thunk's return value. Nested objects, arrays, Maps, and Sets are deep-cloned, but unchanged subtrees keep the same reference. This is the default.
- **`useReactiveShallow`** returns the raw value by reference, with no structural cloning. Use it when you specifically need class identity preserved or when the return value is a primitive.

## Reading a signal

Wrap the `.value` read in a thunk:

```tsx
import { useReactive } from 'signalium/react';
import { signal } from 'signalium';

const count = signal(0);

function Badge() {
  const value = useReactive(() => count.value);
  return <span>{value}</span>;
}
```

This is the minimal form. The thunk just reads `count.value`; the component re-renders when the value changes.

## Reading a reactive function

Pass any arguments inside the thunk, just like a normal function call:

```tsx
import { useReactive } from 'signalium/react';
import { reactive, Signal } from 'signalium';

const slope = signal(2);
const intercept = signal(5);

const linear = reactive((x: number) => slope.value * x + intercept.value);

function Plot({ x }: { x: number }) {
  const y = useReactive(() => linear(x));
  return <span>{y}</span>;
}
```

`useReactive(() => linear(x))` subscribes to everything `linear(x)` subscribes to — both `slope` and `intercept` — and re-renders when either changes.

## Reading a reactive promise

An async `reactive(...)` returns a reactive promise. `useReactive` returns a snapshot of that promise's fields, so state transitions drive re-renders:

```tsx
import { useReactive } from 'signalium/react';
import { reactive } from 'signalium';

const loadUser = reactive(async (id: string) => {
  const res = await fetch(`/api/users/${id}`);
  return res.json();
});

function Profile({ id }: { id: string }) {
  const user = useReactive(() => loadUser(id));

  if (user.isPending) return <p>Loading…</p>;
  if (user.isRejected) return <p>Error: {String(user.error)}</p>;
  return <p>{user.value.name}</p>;
}
```

The snapshot includes `isPending`, `isReady`, `isRejected`, `value`, `error`, and the other reactive-promise fields. Each transition (pending → resolved, etc.) triggers a re-render because the snapshot's flags changed.

See [Reactive promises](/reactivity/reactive-promises) for the full field reference.

## All three patterns in a single example

```tsx
import { useReactive } from 'signalium/react';
import { signal, reactive, Signal } from 'signalium';

const userId = signal('1');

const loadUser = reactive(async (id: string) => {
  const res = await fetch(`/api/users/${id}`);
  return res.json();
});

const greeting = reactive((name: Signal<string>) => `Hello, ${name.value}!`);

function Header() {
  const id = useReactive(() => userId.value);                       // signal
  const user = useReactive(() => loadUser(id));                     // reactive promise
  const label = useReactive(() => greeting(signal(user.value?.name ?? 'stranger'))); // reactive fn

  return (
    <header>
      <span>{label}</span>
      <small>ID: {id}</small>
    </header>
  );
}
```

Every call wraps the read in a thunk. That's the whole API.

## Why thunks?

The thunk form is deliberate — it keeps `useReactive` a single, uniform API that takes "any expression that reads from the graph" and hands back the snapshot. Before thunk-only, there were separate overloads for reading a signal, reading a promise, and calling a reactive function, and they had subtle differences. The thunk collapses all three into one call site:

```tsx
useReactive(() => someSignal.value);
useReactive(() => somePromise);
useReactive(() => someReactiveFn(arg1, arg2));
useReactive(() => someReactiveFn(arg1).value + otherSignal.value);
```

The thunk can contain as much or as little logic as you want. If the expression changes, just update the thunk — no API to relearn.

## Thunk identity matters (a little)

`useReactive` caches the scope's reactive signal by thunk identity. When the thunk identity changes between renders, it reallocates a new cache entry. In practice this rarely matters because the overhead is small, but if you're being careful:

- Inline arrow functions are fine. The overhead is a cache lookup and a fresh `ReactiveSignal`, not a full recompute.
- For hot paths, you can stabilize the thunk with `useCallback`, or let the Signalium Babel preset do it for you — the preset hoists `useReactive` thunks into `useCallback` with the right captures.

```tsx
import { useCallback } from 'react';
import { useReactive } from 'signalium/react';

function Price({ id }: { id: string }) {
  const read = useCallback(() => loadPrice(id), [id]);
  const price = useReactive(read);
  return <span>{price.value}</span>;
}
```

With the Babel preset you don't need this — it's applied automatically. See [Code transforms & async context](/guides/code-transforms) and [Bundler setup](/integrating/bundlers).

## Don't call it inside a reactive function

`useReactive` is a bridge from React into the signal graph. Inside a `component(...)` body, you're already *in* the graph — just read `.value` and call reactive functions directly. The same applies inside a `reactive(...)` body.

```tsx
// Wrong — component body is already inside the graph
const Broken = component(() => {
  const value = useReactive(() => count.value);
  return <span>{value}</span>;
});

// Right — just read it
const Fine = component(() => {
  return <span>{count.value}</span>;
});
```

In development, calling `useReactive` inside a reactive function throws with a message explaining what went wrong. In production the guard is tree-shaken away, but the behavior is undefined — don't rely on it.

## `useReactive` vs `component(...)`

If a component needs to read the signal graph in several places, or if its whole render tracks reactive state, wrap it in `component(...)`. The wrapper is a one-time cost at component definition; each render becomes a single reactive signal, which is cheaper and cleaner than sprinkling `useReactive` calls through a classic component.

| Use `useReactive` when | Use `component(...)` when |
|---|---|
| The component is otherwise a classic hooks-based component | The component's main job is to render reactive state |
| You only read one or two signals | You read many signals across the render |
| You're migrating incrementally and can't convert this component yet | You're writing a new component |
| You're writing a custom hook that wraps reactive reads | You're writing a new component |

Neither is "faster" than the other in a meaningful way, but `component(...)` is cleaner because it hides the `useReactive` boilerplate and removes the need for prop-comparison memoization.

## Reading signals in event handlers and effects

Inside a `component(...)`, event handlers already close over stable signal references — you can read or write `.value` without `useReactive`:

```tsx
const Counter = component(() => {
  const count = useSignal(0);
  return (
    <button onClick={() => {
      console.log('before:', count.value);
      count.value++;
    }}>
      {count.value}
    </button>
  );
});
```

Outside a `component(...)`, `useReactive` is for reads that should *re-render* on change. It's not needed to *write* a signal — writing is just a property assignment:

```tsx
import { cartItems } from '@/state/cart';

function LegacyClearButton() {
  return <button onClick={() => (cartItems.value = [])}>Clear</button>;
}
```

No hook needed — we're not subscribing, just triggering a side effect.

If you want to read a signal imperatively without subscribing (for example, in a one-shot handler), reach for `useRef`-backed ad-hoc access — or better, just call the signal's `.value` in the handler body. Handlers run outside the reactive graph, so reading doesn't subscribe:

```tsx
function Submit() {
  return (
    <button
      onClick={() => {
        fetch('/api/checkout', {
          method: 'POST',
          body: JSON.stringify(cartItems.value), // read, no subscription
        });
      }}
    >
      Checkout
    </button>
  );
}
```

## `useReactiveShallow` for class-identity cases

The deep snapshot returned by `useReactive` deep-clones nested plain objects, arrays, Maps, and Sets. That's usually what you want for React memo semantics — referential equality on unchanged subtrees. But if your reactive function returns an instance of a class that you care about preserving by reference (e.g. a `FormData`, a `Date`, a `ThreeJS.Object3D`, or a user-defined class), use `useReactiveShallow`:

```tsx
import { useReactiveShallow } from 'signalium/react';

function Canvas() {
  const scene = useReactiveShallow(() => buildScene(layers.value));
  return <CanvasView scene={scene} />;
}
```

`useReactiveShallow` returns the thunk's value by reference. Re-renders fire when the reactive signal re-runs — which happens when any signal read inside the thunk updates.

## Summary

- `useReactive(() => expr)` — the default. Deep snapshot, safe to use with `React.memo` and friends.
- `useReactiveShallow(() => expr)` — returns the raw value. Use when class identity matters.
- Inside a `component(...)` body, don't use either — just read `.value` and call reactive functions directly.
- Thunks keep the API uniform across signals, reactive functions, and reactive promises.

## Next steps

- [Hooks interop](/integrating/hooks) — the broader story of mixing hooks and signals.
- [Incremental adoption](/integrating/existing-apps) — using `useReactive` to bridge legacy components into the signal graph.
- [Reactive promises](/reactivity/reactive-promises) — the full reference for what `useReactive(() => somePromise)` gives you.
- [API: signalium/react](/api/signalium/react) — all the React bindings in one place.
