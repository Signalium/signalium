---
title: Local state with useSignal
---

`useSignal` is the Signalium counterpart to `useState`. It creates a component-scoped signal that's stable across renders, disposed on unmount, and updated by assigning to `.value`.

```tsx
import { component, useSignal } from 'signalium/react';

const Counter = component(() => {
  const count = useSignal(0);

  return (
    <div>
      <button onClick={() => count.value--}>-</button>
      <span>{count.value}</span>
      <button onClick={() => count.value++}>+</button>
    </div>
  );
});
```

## `useSignal` vs `useState`

| | `useState` | `useSignal` |
|---|---|---|
| Read | destructure: `const [c, set] = useState(0)` | `const c = useSignal(0)` → `c.value` |
| Write | `setC(c + 1)` or `setC(c => c + 1)` | `c.value++` or `c.update(v => v + 1)` |
| Stable identity | state is a snapshot per render | the signal object is the same every render |
| Re-runs the component | always (when set) | only when the value read would be different |
| Works outside the component | no — state is tied to the component | yes — the signal object can be passed anywhere |

`useSignal` always returns the *same* signal object for the lifetime of the component. What changes is `.value`.

## Reading

Read `.value` anywhere in the component's render to subscribe:

```tsx
const c = useSignal(0);

return (
  <div>
    <p>{c.value}</p>            {/* subscribes */}
    <p>{c.value + 1}</p>        {/* still the same subscription */}
    {c.value > 10 && <Warning />} {/* conditional reads are fine */}
  </div>
);
```

You don't subscribe by touching the signal itself — only by reading `.value`. `console.log(c)` logs the signal object without creating a dependency.

## Writing

Assign directly, or use `.update(fn)` if you want the previous value:

```tsx
c.value = 5;
c.value++;
c.update((prev) => prev + 1);
```

`.update(fn)` is equivalent to `c.value = fn(c.value)` but doesn't read `.value` reactively — it's what you want if you need to mutate based on the previous value from outside a reactive context (for example, in a plain event handler).

## Using signals in event handlers

Event handlers in React close over render-scoped values. That's usually fine — but with `useState`, a stale `count` closure is a common bug:

```tsx
// Stale closure risk
const [count, setCount] = useState(0);
useEffect(() => {
  const id = setInterval(() => setCount(count + 1), 1000);
  return () => clearInterval(id);
}, []); // count is captured at mount, never updates
```

With `useSignal`, the signal object is stable, so reading `.value` inside a closure always sees the current value:

```tsx
const count = useSignal(0);
useEffect(() => {
  const id = setInterval(() => count.value++, 1000);
  return () => clearInterval(id);
}, []); // always sees the current value
```

## Custom equality

Pass an `equals` function if you want to control when updates are considered "real":

```tsx
const query = useSignal('', { equals: () => false }); // always notify
const point = useSignal({ x: 0, y: 0 }, {
  equals: (a, b) => a.x === b.x && a.y === b.y,
});
```

Signals use `Object.is` by default. `equals: false` forces every assignment to notify, which is useful for streams or event-like values where the "sameness" isn't the point.

## Signals as props

Because the signal object is stable, passing it as a prop is cheap and doesn't cause the child to re-render unless a *different* signal is passed:

```tsx
const Child = component(({ count }: { count: Signal<number> }) => {
  return <p>{count.value}</p>;
});

const Parent = component(() => {
  const count = useSignal(0);
  return (
    <>
      <Child count={count} />
      <button onClick={() => count.value++}>+</button>
    </>
  );
});
```

When the button is clicked, only `Child` re-reads `count.value` — `Parent` doesn't re-render because *it* didn't read the signal. `Child` re-renders because *it* did.

This pattern replaces most uses of context purely for avoiding re-renders.

## When not to use `useSignal`

Reach for `useState` if:

- The value doesn't drive reactive consumers — you're tracking something purely local and one-shot (e.g. a menu open flag that only affects one render).
- You want the "reducer" ergonomics of `useReducer` and you don't need fine-grained reactivity.
- You're working in a codebase that still has mostly hooks-based components, and signal vs state churn would be confusing.

There's no performance cliff between the two. Use whichever is clearer in context. `useSignal`'s big win is **when something else needs to derive from this state** — because then `reactive(...)` just works.

## Next steps

- [Derived values with `reactive`](/components/reactive-values) — build computed values from signals without dependency arrays.
- [Signals](/reactivity/signals) — the full reference for how signals behave under the hood.
