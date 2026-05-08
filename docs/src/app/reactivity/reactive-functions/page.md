---
title: Reactive functions
---

A **reactive function** is a plain JavaScript function that knows when to re-run. You wrap a function in `reactive(...)` and Signalium tracks every signal (and every other reactive function) it reads during execution. If any of those dependencies change, the next call re-computes; if nothing changed, it returns the cached result.

```ts
import { signal, reactive } from 'signalium';

const first = signal('Ada');
const last = signal('Lovelace');

const fullName = reactive(() => `${first.value} ${last.value}`);

console.log(fullName()); // "Ada Lovelace"
first.value = 'Grace';
last.value = 'Hopper';
console.log(fullName()); // "Grace Hopper"
```

Conceptually, reactive functions are the **formula cells** of Signalium. [Signals](/reactivity/signals) are the inputs; reactive functions combine and transform them; the result is automatically kept in sync.

## Defining a reactive function

```ts
import { reactive } from 'signalium';

const add = reactive((a: number, b: number) => a + b);
```

The wrapper is the only difference between `add` and a regular function. You call it the same way — `add(1, 2)` — and it returns the same type. TypeScript infers parameters and return type automatically, so you get full type safety with zero ceremony.

A reactive function with no arguments is effectively a lazy derived value:

```ts
const count = signal(0);
const double = reactive(() => count.value * 2);

double(); // 0
count.value = 5;
double(); // 10
```

## Dependency tracking

Whenever a reactive function runs, every signal or reactive function it reads becomes a dependency. The next call checks each dependency: if none have changed, the cached result is returned; otherwise the function re-runs.

```ts
const a = signal(1);
const b = signal(2);
const unused = signal(100);

const sum = reactive(() => {
  return a.value + b.value;
});

sum(); // 3 — depends on a and b
unused.value = 999; // sum is not invalidated; nothing depended on `unused`
sum(); // 3 — still cached
a.value = 10;
sum(); // 12 — re-runs because a changed
```

Tracking is **dynamic**. A reactive function's dependencies can change from one call to the next:

```ts
const left = signal(1);
const right = signal(2);
const direction = signal<'left' | 'right'>('left');

const current = reactive(() => {
  return direction.value === 'left' ? left.value : right.value;
});

current(); // 1 — depends on direction and left
right.value = 99;
current(); // 1 — right wasn't read this time; not a dependency

direction.value = 'right';
current(); // 99 — now depends on direction and right, no longer on left

left.value = 1000;
current(); // 99 — left is no longer a dependency; no re-run
```

There's no "deps array" to maintain, no rule about calling things in the same order every time. Signalium rebuilds the dependency set on each run, which means conditional reads Just Work.

## Memoization

A reactive function is memoized on two things:

1. The **arguments** it was called with.
2. The **signals and reactive functions** it read during that call.

Same arguments, unchanged dependencies → cached result. Different arguments → separate cache entry. Changed dependency → re-run.

```ts
const power = reactive((base: number, exp: number) => {
  return Math.pow(base, exp);
});

power(2, 3); // 8, computed
power(2, 3); // 8, cached
power(2, 4); // 16, computed (different args)
power(2, 4); // 16, cached
power(2, 3); // 8, still cached
```

Each unique argument combination gets its own cache slot, and each slot tracks its own signal dependencies independently. This makes `reactive` an effective memoization primitive even for non-reactive pure functions.

### Argument comparison

Arguments are compared **semi-deeply**:

- Primitives (`number`, `string`, `boolean`, `null`, `undefined`) — by value.
- Plain objects and arrays — structurally, recursively.
- Class instances — by reference.

```ts
const render = reactive((config: { theme: string; size: number }) => {
  // ...
});

render({ theme: 'dark', size: 12 });
render({ theme: 'dark', size: 12 }); // cache hit — structurally equal

class Options {
  constructor(public theme: string) {}
}

const render2 = reactive((opts: Options) => {
  // ...
});

render2(new Options('dark'));
render2(new Options('dark')); // cache miss — different instances
```

Class instances compare by reference because their identity usually *is* meaningful. If you want structural equality for a class, you can register one with [`registerCustomHash`](/api/signalium/utils#registercustomhash).

For full control over the cache key, pass a `paramKey`:

```ts
const loadUser = reactive(
  async (user: { id: string; version: number }) => {
    const res = await fetch(`/api/users/${user.id}?v=${user.version}`);
    return res.json();
  },
  {
    paramKey: (user) => `${user.id}:${user.version}`,
  },
);
```

### Cache lifetime

Cache entries for parameterized calls are held **weakly**. As long as something is observing the result (via a watcher, a component, a parent reactive), the entry is kept alive. Once nothing references it, the entry can be garbage collected and the next call will re-compute from scratch.

In practice this means:

- Actively-used values stay cached.
- Transient calls (e.g. passing `{ id: generateId() }` each time) don't leak.
- You can pass fresh objects as arguments without worrying about unbounded memory growth.

## Composition

Reactive functions can call other reactive functions, and dependencies propagate up through the chain automatically.

```ts
import { signal, reactive } from 'signalium';

const a = signal(1);
const b = signal(2);
const c = signal(3);

const addAB = reactive(() => {
  return a.value + b.value;
});

const addABC = reactive(() => {
  return addAB() + c.value;
});

console.log(addABC()); // 6

a.value = 2;
console.log(addABC()); // 7 — addAB re-ran, addABC re-ran

c.value = 4;
console.log(addABC()); // 8 — only addABC re-ran; addAB was untouched
```

### Stopping propagation

If a reactive function re-runs but its **output** is the same as before, consumers higher up the chain are not invalidated. This is how Signalium keeps large dependency graphs cheap.

```ts
const a = signal(1);
const b = signal(2);
const c = signal(3);

const addAB = reactive(() => {
  console.log('addAB');
  return a.value + b.value;
});

const addABC = reactive(() => {
  console.log('addABC');
  return addAB() + c.value;
});

addABC(); // logs both

a.value = 2;
b.value = 1;
// addAB re-runs (sum is still 3), addABC does NOT re-run.
addABC();
```

Combined with dynamic dependency tracking, this means the graph only does work it strictly needs to. Inner reactives recompute when their inputs change; outer reactives only recompute when the *output* of an inner changed.

## Signal purity

Reactive functions are memoized based on their arguments and the signals they read. That works safely only if the function is **signal-pure**:

{% callout title="Definition: signal-pure" %}
A reactive function is **signal-pure** if:

1. All mutable state it depends on is contained in signals (or other reactive sources tracked by Signalium).
2. Given the same arguments and the same signal values, it always returns the same result.
{% /callout %}

Signal-purity is the reason memoization is safe. Signalium knows exactly which signals were read, so when those signals change, the cached result is invalidated. No signals changed? The result can be reused, even across completely different call sites, because the function would produce the same output.

In practice, this means a few things to avoid:

**Don't read unmanaged mutable state.**

```ts
let counter = 0;

const bad = reactive(() => {
  return counter; // Not tracked — changing `counter` won't invalidate this.
});
```

If you need external state to be reactive, wrap it in a [signal](/reactivity/signals) or a [notifier](/reactivity/signals#notifiers).

**Don't create persistent state inside the function.**

```ts
const getCounter = reactive(() => {
  // This signal is re-created every time getCounter re-runs.
  return signal(0);
});
```

Any signals created inside a reactive function live only for that invocation. The next time the function re-runs (because an argument or dependency changed), the old signals are thrown away and new ones created. This is deliberate — reactive functions aren't lifecycle holders like React components.

If you want persistent per-instance state, pass an identifier in as an argument:

```ts
const getCounter = reactive((id: string) => {
  const count = signal(0);
  const increment = () => count.value++;
  return { count, increment };
});

getCounter('main') === getCounter('main'); // true, cached by id
getCounter('sidebar'); // different instance
```

Same `id` → same memoized return value → same signals.

**Avoid mutating state during a run.** Writing to signals during a reactive function's execution can create cycles, break memoization guarantees, and generally leads to code that's hard to follow. Save mutations for event handlers, relays, or tasks.

## Passing signals vs. passing values

There are two natural ways to give a reactive function access to a changing value: pass the signal itself, or pass the `.value` from an outer reactive:

```ts
import { signal, reactive } from 'signalium';

const count = signal(0);

// Pass the signal.
const doubleFromSignal = reactive((n: Signal<number>) => {
  return n.value * 2;
});

// Pass the value, read in the caller.
const doubleFromValue = reactive((n: number) => {
  return n * 2;
});

doubleFromSignal(count); // 0
doubleFromValue(count.value); // 0
```

Both work. They differ in caching behavior:

- **`doubleFromSignal(count)`** is memoized by the signal *reference*. Called again with the same signal, it returns the cached result only if `count` didn't change. The signal itself is a stable handle, so parameter comparison is effectively free.
- **`doubleFromValue(count.value)`** is memoized by the *value*. The caller has to re-read `count.value` on every call; whoever calls it is now the one with a dependency on `count`.

The second form pushes the dependency up a level. If you want the inner reactive to be completely independent of the caller's dependencies, pass values. If you want the reactive to own the dependency itself, pass signals.

In practice, passing signals scales better when the same reactive function is used from many places with different caching needs. Passing values is simpler when the dependency structure is local.

## `reactiveMethod`

When reactive logic lives on a class instance, use `reactiveMethod(owner, fn)` instead of `reactive(fn)`. The semantics are the same — dependency tracking, memoization, caching — but the reactive is *owned* by an object rather than created globally.

```ts
import { signal, reactiveMethod } from 'signalium';

class Counter {
  count = signal(0);

  double = reactiveMethod(this, () => this.count.value * 2);
}

const a = new Counter();
const b = new Counter();

a.count.value = 2;
b.count.value = 5;

console.log(a.double()); // 4
console.log(b.double()); // 10
```

The key difference from `reactive` appears when [contexts](/reactivity/contexts) enter the picture. A `reactive` function re-evaluates in whichever context it's called from; a `reactiveMethod` stays tied to its owner's scope, regardless of where it's called. This makes it the right tool for class-based stores and services whose behavior should not change based on the caller's context.

For most application code, `reactive` is the default. Reach for `reactiveMethod` when you specifically need owner-scoped memoization. See the [`reactiveMethod` API reference](/api/signalium#reactivemethod) for details.

## Next steps

- [Reactive promises](/reactivity/reactive-promises) — what happens when a reactive function is `async`.
- [Relays](/reactivity/relays) — push-based reactive sources for external events.
- [Contexts](/reactivity/contexts) — dependency injection for reactive code.
- [`reactive` API reference](/api/signalium#reactive)
