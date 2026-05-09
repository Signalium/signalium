---
'signalium': major
---

`ReactivePromise<T>` is now the discriminated union by default.

The exported `ReactivePromise<T>` _type_ is now
`PendingReactivePromise<T> | ReadyReactivePromise<T>` — the same shape that was
previously named `DiscriminatedReactivePromise<T>`. This means `if (p.isReady)`
narrows `p.value` to `T` (no `| undefined`) directly, with no extra type
gymnastics.

The exported `ReactivePromise` _value_ (the class for `instanceof`, `new`, and
the static methods `all` / `race` / `any` / `allSettled` / `resolve` / `reject`
/ `withResolvers`, plus the identifier emitted by the Babel preset's promise
methods transform) is unchanged at runtime. It's now typed as a constructor
interface (the same pattern lib.es5.d.ts uses for the global `Promise`), so:

- `new ReactivePromise<T>()` returns `ReactivePromise<T>` (the union)
- `value instanceof ReactivePromise` narrows to the union
- `ReactivePromise.resolve(x)`, `.all([...])`, etc. return the union

### Breaking changes

- `DiscriminatedReactivePromise<T>` is removed. Replace every reference with
  `ReactivePromise<T>`. The two types are now identical, so the migration is a
  rename.
- The previous wide `ReactivePromise<T>` interface (with `value: T | undefined`
  and `isReady: boolean`) is no longer exported. If you had code that explicitly
  asked for that wide shape, switch to discriminating on `isReady` (or accept
  `PendingReactivePromise<T>` / `ReadyReactivePromise<T>` directly).

### Why

The previous split between a non-discriminated `ReactivePromise<T>` (the class
instance type) and a separate `DiscriminatedReactivePromise<T>` union (what
`useReactive`, `relay()`, async `reactive()`, etc. actually returned) was a
frequent source of confusion. The names suggested they were different shapes
when in practice users almost always wanted the discriminated form. Merging
them removes a footgun and matches the runtime behavior.
