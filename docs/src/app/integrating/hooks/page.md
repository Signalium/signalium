---
title: Hooks interop
---

A `component(...)` is still a React function component. Every hook React ships works inside it, and every hook you've already written works inside it. The signals and reactive functions are just *additional* tools that live alongside hooks — they don't replace them.

This page covers exactly how hooks and signals interact, including the rules you need to remember, the patterns that come up over and over, and the places where picking one over the other actually matters.

## Rules of hooks still apply

Hooks called inside a `component(...)` follow the regular rules of hooks:

- Only at the top level — no conditionals, no loops, no early returns above a hook call.
- Only from React function components or other hooks.
- Order must be stable across renders.

This applies to Signalium's own hooks too — `useSignal`, `useReactive`, `useContext` (from `signalium/react`), and `PauseSignalsProvider` are all hook-shaped APIs that integrate with React's state machine. If a helper starts with `use`, treat it as a hook.

```tsx
import { useState, useEffect } from 'react';
import { component, useSignal } from 'signalium/react';

const Example = component(() => {
  const count = useSignal(0);       // hook
  const [mode, setMode] = useState('idle'); // hook

  useEffect(() => {                  // hook
    console.log('mounted');
  }, []);

  return <p>{count.value}</p>;
});
```

All three hook calls are at the top of the function body, in the same order on every render. Just like any other React component.

## Rules of signals

Signals and reactive functions are *not* hooks. They're plain JavaScript values and plain function calls. The only rules:

- **`signal.value`** is a property read. Do it anywhere — conditionally, in loops, inside handlers, inside effects, inside other reactive functions. You subscribe by reading.
- **Calling a `reactive(...)` function** is a plain call. Same story.
- **`signal(...)` itself** (the constructor) belongs at module scope, in a class, or inside a `component(...)` via `useSignal`. Don't put `signal(...)` inside a `reactive(...)` body — it would create a fresh signal on every invocation and throw away the previous value.
- **`useSignal` is a hook**, because it hooks into React's lifecycle for cleanup. Follows the rules of hooks.

That's it. If you keep those four rules in mind, signals will feel like reading a local variable and hooks will feel like hooks.

```tsx
const Toggle = component(() => {
  const on = useSignal(false);
  const count = useSignal(0);

  if (on.value) {
    return <p>Active: {count.value}</p>;
  }

  return <p>Inactive ({count.value})</p>;
});
```

Reading `on.value` conditionally above the return is fine — it's not a hook, it's a property access.

## `useState` vs `useSignal`

Both are fine to use inside a `component(...)`. Pick based on what happens downstream:

| Scenario | Use |
|---|---|
| Value drives a derived `reactive(...)` | `useSignal` |
| Value needs to be read from another component without a prop | `useSignal` (possibly module-scoped) |
| Value is UI bookkeeping, not consumed elsewhere | `useState` (or `useSignal`, no difference) |
| You want `useReducer` ergonomics | `useState` / `useReducer` |
| You want to pass state by reference without re-rendering the layer that holds it | `useSignal` |

The usual tie-breaker: if anything else (a `reactive(...)`, another component via `useReactive`, a watcher) needs to *observe* this state, use `useSignal`. Otherwise, either works.

See [Local state with useSignal](/components/use-signal) for the full comparison.

## `useRef`: still the right tool for non-reactive slots

`useRef` gives you a mutable slot that survives re-renders without triggering any. That's different from a signal, which *intentionally* triggers re-renders when its value changes. The two don't overlap:

```tsx
import { useRef } from 'react';
import { component, useSignal } from 'signalium/react';

const AnimatedBox = component(() => {
  const lastFrameTime = useRef(performance.now()); // never observed reactively
  const x = useSignal(0);                          // drives render

  const step = () => {
    const now = performance.now();
    const dt = now - lastFrameTime.current;
    lastFrameTime.current = now;
    x.value += dt * 0.1;
  };

  return (
    <div>
      <div style={{ transform: `translateX(${x.value}px)` }} />
      <button onClick={step}>Step</button>
    </div>
  );
});
```

`lastFrameTime.current` is something the component reads and writes but nobody else cares about. `x` drives the DOM and needs to re-render on change. The rule of thumb:

- **`useRef`:** you need a mutable value that should *not* trigger re-renders.
- **`useSignal`:** you need a mutable value that *should* trigger re-renders (or drive other reactive code).

Don't try to replicate `useRef` with a signal that has `equals: false` — that's a different shape of misuse.

## `useEffect` with signals

Effects are still the right tool for imperative side effects (DOM APIs, subscriptions, timers, logging). Reads of `.value` inside an effect's dependency array work the same as any other dependency:

```tsx
import { useEffect } from 'react';
import { component, useSignal } from 'signalium/react';

const TitleSync = component(() => {
  const title = useSignal('Hello');

  useEffect(() => {
    document.title = title.value;
  }, [title.value]);

  return <input
    value={title.value}
    onChange={(e) => (title.value = e.target.value)}
  />;
});
```

The effect re-runs when `title.value` changes — because the dependency array value changes, same as any other dep. The component itself also re-renders, but that's intentional — it's the one that reads `.value`.

{% callout title="Prefer watchers for pure side effects" %}
If the side effect is purely reactive — say, logging to analytics every time a signal changes — consider using [`watcher(...)`](/reactivity/watchers) at module scope instead of `useEffect`. A watcher runs outside React's render cycle and doesn't need a component to exist. `useEffect` is still the right tool when the effect depends on component-specific state or needs to clean up when the component unmounts.
{% /callout %}

### When effects need the *current* value of a signal

Signals are stable — the signal object is the same reference across renders, but `.value` changes. That means you can read `.value` inside an effect callback even if it's not in the dependency array, and you'll get the current value each time the effect runs:

```tsx
const Latest = component(() => {
  const count = useSignal(0);

  useEffect(() => {
    const id = setInterval(() => {
      console.log('current', count.value); // always current, not stale
    }, 1000);
    return () => clearInterval(id);
  }, []); // don't depend on count.value — we read it live

  return <button onClick={() => count.value++}>{count.value}</button>;
});
```

This is the `useState` stale-closure bug, fixed for free. If you specifically *want* the effect to re-run on value change, put `count.value` in the dep array. If you want to read the live value from a handler running inside a long-lived effect, just access `count.value` directly.

## `useContext` from React vs `useContext` from `signalium/react`

Both exist. Both work. They're different systems:

- `React.useContext(ReactCtx)` reads a React context created with `React.createContext(...)`.
- `useContext` from `signalium/react` reads a [Signalium context](/reactivity/contexts) created with `context(...)` from the core package.

You can use both in the same component. Signalium contexts are the ones that `reactive(...)` functions can read through `getContext`. Use Signalium contexts when reactive code needs to read them; use React contexts when only React components need the value.

```tsx
import { useContext as useReactContext } from 'react';
import { component, useContext } from 'signalium/react';
import { ReactTheme } from '@/theme/react-context';
import { ApiClient } from '@/api/context';

const Screen = component(() => {
  const theme = useReactContext(ReactTheme);       // React context
  const api = useContext(ApiClient);                // Signalium context
  return <p style={{ color: theme.color }}>Connected to {api.baseUrl}</p>;
});
```

## Writing custom hooks that wrap signals

Custom hooks compose with signals the same way they compose with other values. A hook can:

- Read a signal from module scope and return `.value` (use `useReactive` under the hood for plain components).
- Accept a signal as a parameter and return a derived value.
- Subscribe a classic component to a reactive function.

```tsx
import { useReactive } from 'signalium/react';
import { reactive, Signal } from 'signalium';

const currency = reactive((amount: Signal<number>, code: string) =>
  new Intl.NumberFormat('en', { style: 'currency', currency: code }).format(amount.value),
);

export function useFormattedPrice(amount: Signal<number>, code: string) {
  return useReactive(() => currency(amount, code));
}
```

Inside a `component(...)` you'd just call `currency(amount, code)` directly — no hook needed. The `useFormattedPrice` variant is for plain function components that still need to consume the reactive graph.

See [useReactive & imperative reads](/integrating/use-reactive) for more on this boundary.

## You can't use hooks inside reactive functions

Reactive functions run outside React's render cycle. They can run in response to any signal change, at any time, including on the server, inside a web worker, or from a relay's `update` callback. Hooks depend on React's renderer machinery being active.

```tsx
// Invalid — hooks can't run here
const doubled = reactive(() => {
  const [n] = useState(0); // throws
  return n * 2;
});
```

The fix is always the same: move the state out to a signal passed in as a parameter, or to module scope. If you need the state to be component-local, keep the reactive function inline inside the `component(...)` and have it close over a `useSignal` you already have.

```tsx
const Counter = component(() => {
  const n = useSignal(0);
  const doubled = reactive(() => n.value * 2);
  return <p>{doubled()}</p>;
});
```

## You can't create signals inside reactive functions

`signal(...)` at module scope is fine. `signal(...)` inside a `reactive(...)` body is a bug — the signal gets re-created every time the reactive function runs, and its "state" is immediately thrown away. Use `useSignal` inside `component(...)`, pass signals in as parameters to `reactive(...)`, or declare signals at module scope.

```tsx
// Wrong: new signal every run
const broken = reactive(() => {
  const counter = signal(0); // fresh every time
  return counter.value;
});

// Right: pass it in
const withCounter = reactive((counter: Signal<number>) => counter.value);
```

See [Signals & reactive functions](/reactivity/signals) for the underlying "signal-purity" rationale.

## `useMemo` and `useCallback` — usually redundant

Inside a `component(...)`:

- `useMemo` for a derived value is better written as `reactive(...)`. You don't need a dependency array; you get memoization across all invocations, not just this render.
- `useCallback` for a handler is usually unnecessary — the component only re-renders when something tracked changed, so a fresh closure each render isn't a performance concern.

```tsx
import { component, useSignal } from 'signalium/react';
import { reactive } from 'signalium';

const Search = component(() => {
  const query = useSignal('');
  const results = reactive(() => runSearch(query.value));

  return (
    <div>
      <input
        value={query.value}
        onChange={(e) => (query.value = e.target.value)}
      />
      <ul>
        {results().map((r) => (
          <li key={r.id}>{r.title}</li>
        ))}
      </ul>
    </div>
  );
});
```

No `useMemo`, no `useCallback`, no `React.memo` on the child. `results()` is memoized by `reactive`; the component only re-renders when `query.value` produces a different `results()` return.

There are edge cases where you still want `useMemo` — e.g. you need a value computed from React state (not a signal) that's expensive, and you don't want to turn it into a signal. In that case `useMemo` still works. Just reach for `reactive(...)` first.

## `useSyncExternalStore` — already handled

You don't need `useSyncExternalStore` when working with signals directly. `component(...)` and `useReactive` both wire it up for you internally. The external-store hook is a building block for *creating* reactive bridges — signals are already a bridge.

If you're writing a custom subscription primitive (e.g. integrating a library that has its own change notifications), then yes, `useSyncExternalStore` is still the tool — but almost always you can skip a step by wrapping the library's notifications in a signal or a [relay](/reactivity/relays).

## Rules of signals recap

Four rules:

1. `useSignal` is a hook — rules of hooks apply (and `useReactive`, `useContext` from `signalium/react` too).
2. Reading `signal.value` is a property access — do it anywhere.
3. Calling `reactive(...)` functions is a plain call — do it anywhere.
4. Don't create signals inside reactive functions (use `useSignal`, module scope, or pass signals in as parameters).

Rules of hooks still apply for the React hooks themselves. Rules of signals add nothing to those rules — they just describe a *smaller* set of constraints on the signal side.

## Next steps

- [useReactive & imperative reads](/integrating/use-reactive) — the hook for reading signals from plain function components.
- [Incremental adoption](/integrating/existing-apps) — concrete patterns for introducing signals into an existing app.
- [Layering on React](/components/layering) — the conceptual story of how Signalium sits on top of React.
- [Reactive functions](/reactivity/reactive-functions) — the full reference for `reactive(...)`.
