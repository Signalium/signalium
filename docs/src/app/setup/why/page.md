---
title: Why Signalium?
---

React is a great rendering layer. But the moment you need to share state, derive from it, or coordinate async work, the ceremony piles up: `useState` + `useEffect` + `useMemo` + dependency arrays + selectors + context providers + a state library or two.

Signalium's thesis is simple: **the reactivity layer should be invisible**. You describe values and how they derive from each other; the system figures out what runs when.

## What Signalium is

- **A reactivity engine.** Signals are the atomic unit of state. Reactive functions derive values from signals. Both are memoized and re-run only when their actual dependencies change.
- **A React integration.** `component(...)` wraps a React function component so that reads of signals and reactive functions are automatically tracked. No `useMemo`, no `useCallback`, no `React.memo`.
- **Async-first.** `async reactive` functions return reactive promises — memoized, deduped, Suspense-compatible. Async components work with real `await`.
- **Framework-agnostic at the core.** The engine has zero React dependency. The same signals you use in a component also work in Node, workers, tests, or any other framework.

## What Signalium is *not*

- Not a replacement for React. You still render with JSX, compose with components, handle events, use Suspense and portals, etc.
- Not a global store. There's no singleton, no "store instance" to wire up. Signals are plain values.
- Not opinionated about state shape. Use plain objects, classes, maps, sets — whatever you like.

## Compared to React's built-ins

| Problem | React idiom | Signalium idiom |
|---|---|---|
| Local state | `useState` | `useSignal` — same ergonomics, no dep arrays |
| Derived state | `useMemo(fn, [deps])` | `reactive(fn)` — no dep array, works anywhere |
| Shared state | `useContext` + a provider + a reducer | `signal(...)` at module scope |
| Memoized handlers | `useCallback(fn, [deps])` | usually unnecessary; `component` memoizes structurally |
| Async data | `useEffect` + loading booleans | `async reactive` + `Suspense` |
| Preventing re-renders | `React.memo` + selectors | built in — `component` only re-runs on real changes |

## Compared to other signal libraries

- **Jotai / Recoil / Zustand**: Signalium gives you first-class async, no selectors, and fine-grained updates without atoms. Reactive functions compose directly; there's no distinction between atoms, selectors, and derived atoms.
- **MobX**: Similar in spirit but with a much smaller API, built-in async, and no decorators or classes required. Works with functional React idiomatically.
- **Preact Signals / Solid**: Closer in spirit to Signalium. Signalium adds reactive promises, relays for push-based sources, and a Context system for dependency injection.

## When to reach for Signalium

- You have components that derive a lot of state from props/state and are tired of `useMemo` dependency arrays.
- You have async data that multiple components need, and `useEffect` + loading states are getting out of hand.
- You're sharing state across unrelated parts of the tree and context providers feel heavy.
- You want Suspense without buying into RSC or a specific data-fetching library.
- You want the same derivation logic to work on the server, in a worker, or in tests — without a React runtime.

If any of those land, read on: [Your first component](/components/first-component) shows the minimum viable Signalium app.
