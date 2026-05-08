---
title: Your first component
---

A Signalium component is a regular React function component wrapped in `component(...)`. The wrapper tells Signalium to track reads of signals and reactive functions during the render so it can re-run the component exactly when one of those reads would produce a different value.

```tsx
import { component, useSignal } from 'signalium/react';

const Counter = component(() => {
  const count = useSignal(0);

  return (
    <div>
      <p>Count: {count.value}</p>
      <button onClick={() => count.value++}>Increment</button>
    </div>
  );
});
```

That's the whole mental model:

- Write a React function.
- Wrap it in `component(...)`.
- Use `useSignal` instead of `useState` when you want fine-grained reactivity.
- Read `count.value` to subscribe; write to it to update.

You can mix and match with anything else React ships. JSX, hooks, Suspense, portals, event handlers — all of it works.

## Why `component(...)` at all?

Without the wrapper, a React function component re-renders every time its parent re-renders, unless you manually wrap it in `React.memo` and supply a comparator. Even then, `useMemo` and `useCallback` need dependency arrays to stay in sync.

`component(...)` does both jobs automatically:

1. **Structural memoization.** Props are compared semi-deeply — plain objects and arrays are compared by value, class instances and reactive objects by reference. If nothing changed, the render is skipped.
2. **Reactivity tracking.** Every signal and reactive function read during the render is remembered. The component re-runs when (and only when) one of those would produce a new value.

You don't need `useMemo` for derived values inside a `component` — use `reactive(...)` instead. You don't need `useCallback` for handlers — the component only re-runs when something actually changed, so a fresh closure on every render is fine.

## What you *can* do inside a component

Everything you already do in a React function component:

- Regular hooks (`useState`, `useRef`, `useEffect`, `useLayoutEffect`, `useMemo`, `useCallback`, `useContext`) — all allowed, all follow the normal rules of hooks.
- Signalium hooks — `useSignal`, `useReactive`, `useContext` from `signalium/react`. Also follow the rules of hooks.
- Reading signals directly: `count.value`.
- Calling reactive functions directly: `doubled()`.
- Using JSX, fragments, portals, Suspense, `use(...)`.

## What you *can't* do inside a component

You can do almost anything, but there are two small rules:

1. `useSignal` is still a hook and must follow the rules of hooks (top of the function, no conditionals).
2. If you declare a `reactive(...)` inside the body, it closes over render-scoped values — that's fine, but be aware the reactive function's identity is stable across renders and its cached result will only update when the signals it reads update.

Reading a signal and calling a reactive function, on the other hand, are not hooks. You can do them conditionally, in loops, inside event handlers, inside other reactive functions — anywhere.

```tsx
const Toggle = component(() => {
  const flag = useSignal(true);
  const a = useSignal(1);
  const b = useSignal(2);

  const value = flag.value ? a.value : b.value;

  return <p>{value}</p>;
});
```

This works. `flag`, `a`, and `b` are signals — reading them is a plain property access, not a hook.

## Props

Props are passed the same way as any React component:

```tsx
type GreetingProps = { name: string };

const Greeting = component<GreetingProps>(({ name }) => {
  return <h1>Hello, {name}!</h1>;
});

<Greeting name="Ada" />;
```

Prop comparison happens semi-deeply. If the parent re-renders and passes props that are structurally equivalent — same shape, same primitive values, same class instances — the child is skipped.

{% callout title="Signals as props" %}
You can also pass signals as props. The signal reference is stable, so the component is skipped on re-render unless a non-signal prop actually changed. Inside the component, read `signal.value` to subscribe. This lets you hoist state without forcing re-renders at every layer.
{% /callout %}

## Using regular hooks alongside

Signalium components are still React components. Regular hooks work exactly like they do anywhere else:

```tsx
import { useState, useEffect } from 'react';
import { component, useSignal } from 'signalium/react';

const Timer = component(() => {
  const [start] = useState(() => Date.now());
  const elapsed = useSignal(0);

  useEffect(() => {
    const id = setInterval(() => {
      elapsed.value = Date.now() - start;
    }, 100);
    return () => clearInterval(id);
  }, []);

  return <p>{elapsed.value}ms</p>;
});
```

`useState` for something that never needs to be observed reactively. `useSignal` for the value that drives the UI. `useEffect` for side effects. Nothing is redundant — each tool does what it's best at.

## Next steps

- [Local state with `useSignal`](/components/use-signal) — understand the differences between `useSignal` and `useState`, and when to pick each.
- [Derived values with `reactive`](/components/reactive-values) — replace `useMemo` with reactive functions that work anywhere.
- [Async components & Suspense](/components/async) — use `async`/`await` directly in components with proper Suspense integration.
- [Layering on React](/components/layering) — understand precisely how `component` coexists with everything else in a React app.
