---
title: Signals
---

A **signal** is a mutable value that the reactive graph knows about. It's the one primitive that everything else in Signalium is built on: [reactive functions](/reactivity/reactive-functions), [reactive promises](/reactivity/reactive-promises), [relays](/reactivity/relays), and [watchers](/reactivity/watchers) all ultimately exist to read from and react to signals.

If you've used a spreadsheet, signals are the input cells — the raw values you type in. Reactive functions are the formula cells that derive from them.

```ts
import { signal } from 'signalium';

const count = signal(0);

console.log(count.value); // 0

count.value = 1;
console.log(count.value); // 1
```

That's the entire surface for a basic signal: create one with `signal(initialValue)`, read its current value through `.value`, and write to it by assigning to `.value`.

## Creating signals

```ts
import { signal } from 'signalium';

const name = signal('Ada');
const count = signal(0);
const items = signal<string[]>([]);
const user = signal<{ id: string; name: string } | null>(null);
```

A signal holds any value — primitives, objects, arrays, class instances, other signals. Signalium does not try to make the contents of the signal reactive; only the act of replacing the value is tracked. If you want a nested reactive shape, use more signals.

```ts
// Not this — the reactive graph has no way to know when
// user.value.name is mutated.
const user = signal({ name: 'Ada' });
user.value.name = 'Grace';

// Either replace the whole object…
user.value = { ...user.value, name: 'Grace' };

// …or reach for more signals.
const user = { name: signal('Ada') };
user.name.value = 'Grace';
```

## Reading signals

Reading `.value` serves two purposes. It returns the current value, and it **registers a dependency** on whatever reactive code is currently running. That's why signals are objects rather than plain variables — Signalium needs a hook into the read.

```ts
import { signal, reactive } from 'signalium';

const count = signal(0);

const double = reactive(() => {
  // Reading `.value` here tells the reactive graph:
  // "double depends on count".
  return count.value * 2;
});

console.log(double()); // 0

count.value = 5;
console.log(double()); // 10
```

Outside of a reactive context (just plain imperative code), `.value` is still a valid read — it just doesn't get tracked. This is what lets you pull the current value of a signal in an event handler or inside a plain function.

## Writing signals

There are two ways to update a signal:

```ts
const count = signal(0);

count.value = count.value + 1;

count.update((v) => v + 1);
```

The difference is subtle but real. Setting `.value = ...` first *reads* the current value, which counts as a consumption if the assignment happens inside a reactive context. `update` takes the current value as an argument and does **not** consume it — use it when you want to update a signal from inside something reactive without creating a dependency on its previous value.

```ts
import { signal, reactive } from 'signalium';

const count = signal(0);

const incrementDependent = reactive(() => {
  // Creates a dependency on count — this reactive will
  // re-run every time count changes.
  count.value = count.value + 1;
});

const incrementIndependent = reactive(() => {
  // No dependency — this reactive does not observe count.
  count.update((v) => v + 1);
});
```

In most application code you won't be writing to signals from inside reactive functions anyway (see [signal purity](/reactivity/reactive-functions#signal-purity)). But when you are — most commonly inside [relays](/reactivity/relays) or [tasks](/reactivity/reactive-promises#tasks) — `update` is the safer choice.

## Equality and change detection

By default, Signalium compares the old and new value with `===`. Writing the same primitive twice is a no-op:

```ts
const count = signal(0);

count.value = 0; // no notification; nothing observed a change
count.value = 1; // notifies subscribers
count.value = 1; // no-op again
```

For objects and arrays, `===` compares references. Replacing `{ a: 1 }` with a structurally-equal `{ a: 1 }` will be treated as a change because they're different references. You can override this with an `equals` function:

```ts
import { signal } from 'signalium';

const user = signal(
  { id: '1', name: 'Ada' },
  {
    equals: (a, b) => a.id === b.id && a.name === b.name,
  },
);

user.value = { id: '1', name: 'Ada' }; // no-op: equals returns true
```

If you want every write to notify — even with identical values — pass `equals: false`:

```ts
const tick = signal(0, { equals: false });

tick.value = 0; // still notifies
tick.value = 0; // still notifies
```

This is rare, but occasionally useful for "pulse" signals where each write is itself the event. Most of the time, [notifiers](#notifiers) are a better fit.

## Notifiers

A **notifier** is a special zero-value signal. It has no value to read; all it does is record a dependency when you `consume()` it and invalidate that dependency when you `notify()`.

```ts
import { notifier, reactive } from 'signalium';

const invalidate = notifier();

let externalCounter = 0;

const getCounter = reactive(() => {
  invalidate.consume();
  return externalCounter;
});

getCounter(); // 0
externalCounter = 1;
getCounter(); // still 0 — the reactive hasn't been invalidated

invalidate.notify();
getCounter(); // 1
```

Notifiers are the right tool when you have mutable state *outside* the signal graph that you still want reactive code to react to — for example, wrapping an object that emits events, or manually controlling when a cached computation should be considered stale.

They're also useful as a building block for more complex reactive sources when a full [relay](/reactivity/relays) is overkill.

## Signals vs. React state

If you're coming from React, it's tempting to map signals onto `useState`. They occupy similar conceptual space but have different semantics:

| | `useState` | `signal` |
| --- | --- | --- |
| Scope | Component-local | Any scope — module, class, function |
| Update timing | Schedules a render; value updates next render | Updates immediately; dependents see the new value on next read |
| Identity | Recreated per render | Stable across reads |
| Who re-runs | Every component that uses it | Only the reactive code that *read* this specific signal |

A `signal` can live anywhere — as a module-level export, as a field on a class, as a local in a reactive function. There's no component lifetime involved unless you opt into one via `useSignal` from `signalium/react`.

```ts
// A module-level signal — shared across the whole app.
export const currentUser = signal<User | null>(null);
```

```tsx
import { component, useSignal } from 'signalium/react';

// A component-local signal — scoped to this mount, like useState.
const Counter = component(() => {
  const count = useSignal(0);
  return <button onClick={() => count.value++}>{count.value}</button>;
});
```

Both are just signals. The difference is where they live.

## When does a signal make sense?

Reach for a signal when you have a piece of mutable state that other code should react to. The "should react to" part is load-bearing — if nothing ever reads the value from a reactive context, a signal buys you nothing over a plain variable.

A rough checklist:

- **Is this value going to change over time?** If no, it doesn't need to be reactive. A `const` is fine.
- **Does something need to recompute when it changes?** If no, a plain `let` is fine.
- **Do the consumers want to be notified automatically, or can they poll?** If they can poll, a plain variable works. If they need to stay in sync, a signal does it for you.

Signals are cheap, but they're not free — you're paying for the dependency tracking. Don't wrap every variable. Wrap the ones that matter.

{% callout title="Rule of thumb" %}
Think of signals as **annotations** on your mutable state. Any plain variable is assumed non-reactive and shouldn't affect reactive output. Any signal is explicitly reactive — callers can rely on it propagating changes. This distinction alone makes state changes in a Signalium app much easier to reason about than they are in a "everything could re-render at any time" world.
{% /callout %}

## Next steps

- [Reactive functions](/reactivity/reactive-functions) — derive values from signals.
- [Reactive promises](/reactivity/reactive-promises) — signals for async work.
- [Relays](/reactivity/relays) — signals backed by push-based external sources.
- [`signal` API reference](/api/signalium#signal)
