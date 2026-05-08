---
title: Layering on React
---

Signalium does not replace React. It sits *on top* of React and removes the busywork around memoization, dependency arrays, and re-render gating. Everything React already gives you — JSX, hooks, Suspense, context, error boundaries, portals, transitions, the Compiler, the DevTools — keeps working exactly as it did.

If you've ever worked with a library that wanted you to wrap your app in a new root, learn a new component primitive, and abandon your existing hooks — this is not that library.

## The actual surface area

Here's what `component(...)` adds on top of a normal React function:

```tsx
// Without Signalium
function Counter() {
  const [count, setCount] = useState(0);
  const doubled = useMemo(() => count * 2, [count]);
  return <p onClick={() => setCount(count + 1)}>{doubled}</p>;
}

// With Signalium
const Counter = component(() => {
  const count = useSignal(0);
  const doubled = reactive(() => count.value * 2);
  return <p onClick={() => count.value++}>{doubled()}</p>;
});
```

Notice what *didn't* change:

- Still a function returning JSX.
- Still fires DOM event handlers the same way.
- Still takes props, still uses React's render/commit cycle.
- Still shows up as `Counter` in React DevTools.

What did change:

- `useState` → `useSignal`. Same ergonomics, no dep arrays downstream.
- `useMemo(fn, [deps])` → `reactive(fn)`. No dep array.
- `function` → `component(function)`. A single wrapper call.

## What still works unchanged

### Regular hooks

```tsx
import { useState, useRef, useEffect, useLayoutEffect, useContext } from 'react';

const Chart = component((props) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<'line' | 'bar'>('line');

  useEffect(() => {
    // draws on ref.current
  }, [mode]);

  return <canvas ref={ref} />;
});
```

All of these are vanilla React. `useSignal` follows the rules of hooks too.

### React context

`React.createContext` and the `Context.Provider` you already have continue to work. Signalium has its *own* context system ([Providing context](/components/contexts)) for dependency injection into reactive code, but you don't have to migrate existing React contexts to it.

```tsx
const ThemeCtx = React.createContext('light');

const Label = component(() => {
  const theme = React.useContext(ThemeCtx);
  return <span>{theme}</span>;
});
```

### Suspense, error boundaries, portals, transitions

- `<Suspense>` handles async `component(async () => …)` the same way it handles any other suspending child. See [Async components & Suspense](/components/async).
- Error boundaries catch errors from Signalium components exactly like any other React component.
- `createPortal`, `startTransition`, `useDeferredValue`, `use` — all work.

### React Compiler

`component(...)` composes with the React Compiler. The compiler can still optimize inside the function body; `component(...)` just adds fine-grained reactivity to whatever the compiler produced.

### Third-party component libraries

Anything that expects a React function component works. Signalium components render like React function components — they just skip renders more aggressively when inputs didn't change.

## Coexistence with hooks-based components

Hooks-based components and `component`-wrapped components live in the same tree with no boundary. A `component(...)` can render a plain function component and vice versa:

```tsx
const SignaliumCounter = component(() => {
  const count = useSignal(0);
  return (
    <div>
      <RegularDisplay value={count.value} />  {/* plain function */}
      <button onClick={() => count.value++}>+</button>
    </div>
  );
});

function RegularDisplay({ value }: { value: number }) {
  return <p>{value}</p>;
}
```

`RegularDisplay` is a normal function component. It receives `value` as a prop and re-renders when its parent does, like any other React component. Nothing Signalium-specific.

Going the other way — a hooks-based component that wants to consume a signal — is where [`useReactive`](/integrating/use-reactive) comes in. It's the escape hatch for legacy components or custom hooks that need to read reactive values without converting to `component(...)`.

## What actually changes under the hood

`component(fn)` returns a function that, when rendered, does two things:

1. Runs `fn` inside a reactive tracking scope, remembering every signal and reactive function you read.
2. Calls `React.memo`-style prop comparison before re-rendering. If props are structurally equivalent *and* nothing tracked has changed, the render is skipped entirely.

It's basically `React.memo(fn)` + `useSyncExternalStore` wired to a fine-grained dependency tracker, done for you.

## The incremental adoption story

Because the two models coexist freely, you can adopt Signalium in tiny steps:

1. Pick one component that's suffering from `useMemo` dependency hell. Wrap it in `component(...)`. Replace its `useState` with `useSignal`, its `useMemo` with `reactive(...)`.
2. Ship it. Everything else in the app still works.
3. Next week, do one more.

You never have to commit to a migration. Mixed is a stable end state.

## The "rules of signals"

Think of signals as *regular JavaScript values*, not hooks. The only rules:

- `useSignal` is a hook (follows rules of hooks).
- Reading `signal.value` is a plain property access. Do it anywhere, any time, any number of times.
- Calling `reactive(...)` functions is a plain function call. Same story.
- Creating new signals (`signal(...)`) at module scope or in a class is fine; inside a `reactive(...)` body is not (the signal would be created fresh each run).

Compared to the rules of hooks, there's almost nothing to remember.

## Next steps

- [Incremental adoption](/integrating/existing-apps) — concrete migration patterns for an existing codebase.
- [Hooks interop](/integrating/hooks) — the full story on mixing `component(...)` with standard hooks, including `useReactive` for reading signals from legacy code.
