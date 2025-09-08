---
title: signalium/react
nextjs:
  metadata:
    title: signalium/react API
    description: React bindings API
---

## Functions

### component

```ts
export default function component<Props extends object>(
  fn: (props: Props) => React.ReactNode | React.ReactNode[] | null,
): (props: Props) => React.ReactElement;
```

Create a reactive component from a pure function. Inside the function, read `Signal` values and other reactive sources directly. Re-renders are scheduled automatically when dependencies change.

```tsx
import { component, useSignal } from 'signalium/react';
import { reactive, type Signal } from 'signalium';

const fullName = reactive(
  (first: Signal<string>, last: Signal<string>) =>
    `${first.value} ${last.value}`,
);

const Name = component(() => {
  const first = useSignal('Ada');
  const last = useSignal('Lovelace');

  return (
    <div>
      <p>{fullName(first, last)}</p>
      <button onClick={() => (first.value = 'Grace')}>First → Grace</button>
      <button onClick={() => (last.value = 'Hopper')}>Last → Hopper</button>
    </div>
  );
});
```

| Parameter | Type                          | Description     |
| --------- | ----------------------------- | --------------- |
| fn        | `(props: Props) => ReactNode` | Render function |

### useSignal

```ts
export function useSignal<T>(
  value: T,
  opts?: {
    equals?: (prev: T, next: T) => boolean | false;
    id?: string;
    desc?: string;
  },
): Signal<T>;
```

Create a component-scoped `Signal<T>` for local state. The signal is stable across renders and disposed on unmount. Prefer `useSignal` over `useState` when you want granular reactivity and direct reads.

```tsx
import { component, useSignal } from 'signalium/react';

const Counter = component(() => {
  const count = useSignal(0);

  return (
    <div>
      <button onClick={() => count.update((v) => v - 1)}>-</button>
      <span>{count.value}</span>
      <button onClick={() => count.update((v) => v + 1)}>+</button>
    </div>
  );
});

// Custom equality (always update)
const Search = component(() => {
  const query = useSignal('', { equals: () => false });
  return (
    <input
      value={query.value}
      onChange={(e) => (query.value = e.target.value)}
    />
  );
});
```

Signals can be passed as parameters to reactive functions, and the reactive function will update _less often_ with signal parameters than with plain values. This is because reactive functions will rerun lazily, from innermost to outermost, and only rerun if the parameters or the signals they access have changed.

```tsx
import { reactive, type Signal } from 'signalium';
import { component, useSignal } from 'signalium/react';

// Deeply nested reactive graph
const formatName = reactive((first: Signal<string>, last: Signal<string>) => {
  return `${first.value} ${last.value}`;
});

const greeting = reactive(
  (prefix: Signal<string>, first: Signal<string>, last: Signal<string>) => {
    return `${prefix.value} ${formatName(first, last)}`;
  },
);

const cardText = reactive(
  (
    title: Signal<string>,
    prefix: Signal<string>,
    first: Signal<string>,
    last: Signal<string>,
  ) => {
    return `[${title.value}] ${greeting(prefix, first, last)}`;
  },
);

const ProfileCard = component(() => {
  const title = useSignal('Engineer');
  const prefix = useSignal('Hello,');
  const first = useSignal('Ada');
  const last = useSignal('Lovelace');

  // Passing signals means only the minimal inner layers recompute
  const text = cardText(title, prefix, first, last);

  return (
    <div>
      <p>{text}</p>
      <button onClick={() => (first.value = 'Grace')}>First → Grace</button>
      <button onClick={() => (last.value = 'Hopper')}>Last → Hopper</button>
      <button onClick={() => (prefix.value = 'Hi,')}>Prefix → Hi,</button>
      <button onClick={() => (title.value = 'Captain')}>Title → Captain</button>
    </div>
  );
});
```

When `first` or `last` change, only `formatName` (and dependents) recompute. `cardText` does not rerun unless its own signal params (`title`, `prefix`, `first`, `last`) change or a nested reactive it calls produces a new value. Passing plain values instead of `Signal`s would force outer layers to rerun more often.

| Parameter   | Type                                       | Description       |
| ----------- | ------------------------------------------ | ----------------- |
| value       | `T`                                        | Initial value     |
| opts.equals | `((prev: T, next: T) => boolean) \| false` | Equality function |
| opts.id     | `string`                                   | Debug identifier  |
| opts.desc   | `string`                                   | Debug description |

### useReactive

```ts
export function useReactive<R>(signal: Signal<R>): R;
export function useReactive<R>(signal: ReactivePromise<R>): ReactivePromise<R>;
export function useReactive<R, Args extends readonly unknown[]>(
  fn: (...args: Args) => R,
  ...args: Args
): R;
```

Helper function to read reactive values in standard React components **that are not defined with `component`**. This hook is only needed if you are not converting a component to a reactive component, OR if you are using a reactive value inside of a custom hook that is also used in non-reactive components.

Examples:

```tsx
import { useSignal, useReactive } from 'signalium/react';
import { reactive, task } from 'signalium';

// 1) Read a signal
const Display = () => {
  const message = useSignal('hello');
  const value = useReactive(message);
  return <p>{value}</p>;
};

// 2) Read a computed reactive function
// Here we create a reactive function and use it directly
const computeArea = reactive(
  (width: Signal<number>, height: Signal<number>) => width.value * height.value,
);

const Area = () => {
  const width = useSignal(3);
  const height = useSignal(4);
  const area = useReactive(computeArea, width, height);

  return (
    <div>
      <p>Area: {area}</p>
      <button onClick={() => (width.value += 1)}>W+1</button>
      <button onClick={() => (height.value += 1)}>H+1</button>
    </div>
  );
};

// 3) Read an async reactive function
const fetchUser = reactive(async (id: string) => {
  const res = await fetch(`/api/users/${id}`);
  return res.json() as Promise<{ id: string; name: string }>;
});

const User = () => {
  let user = useReactive(fetchUser, '1');

  return (
    <div>
      {user.isPending && <p>Loading…</p>}
      {user.error && <p>Error</p>}
      {user.isReady && <p>{user.value.name}</p>}
    </div>
  );
};
```

| Overload        | Parameters                    | Returns                             |
| --------------- | ----------------------------- | ----------------------------------- |
| Signal          | `signal: Signal<R>`           | `R`                                 |
| ReactivePromise | `signal: ReactivePromise<R>`  | `ReactivePromise<R>`                |
| Function        | `fn: (...args) => R, ...args` | `R` (or `ReactivePromise` if async) |

### useContext

```ts
export function useContext<T>(context: Context<T>): T;
```

Read a context value inside React components. Use with `ContextProvider` to supply values. Is cross-compatible between reactive and non-reactive components, but should still follow the rules of hooks inside reactive components.

```tsx
import { component, useContext, ContextProvider } from 'signalium/react';
import { context } from 'signalium';

const Theme = context<'light' | 'dark'>('light');

const Label = component(() => {
  const theme = useContext(Theme);
  return <span>Theme: {theme}</span>;
});

const App = component(() => (
  <ContextProvider contexts={[[Theme, 'dark']]}>
    <Label />
  </ContextProvider>
));
```

| Parameter | Type         | Description     |
| --------- | ------------ | --------------- |
| context   | `Context<T>` | Context to read |

### ContextProvider

```tsx
export function ContextProvider(props: {
  contexts?: [...ContextPair<unknown[]>] | [];
  inherit?: boolean;
  children: React.ReactNode;
}): React.ReactElement;
```

Provide contexts to a React subtree using an array of context pairs. A context pair is a 2-tuple of `[Context<T>, T]`. This component is a flattened alternative to nesting many providers — pass multiple pairs in a single `contexts` array instead of creating deeply nested providers. Set `inherit={false}` to create an isolated scope that does not read parent contexts.

```tsx
import { component, ContextProvider, useContext } from 'signalium/react';
import { context } from 'signalium';

const Theme = context<'light' | 'dark'>('light');
const Lang = context<'en' | 'es'>('en');

const Read = component(() => {
  const theme = useContext(Theme);
  const lang = useContext(Lang);
  return (
    <p>
      {lang} / {theme}
    </p>
  );
});

const App = component(() => (
  <ContextProvider
    contexts={[
      [Theme, 'dark'],
      [Lang, 'es'],
    ]}
  >
    {/* Both Theme and Lang are provided without nesting */}
    <Read />

    {/* Override Lang only for a subtree */}
    <ContextProvider contexts={[[Lang, 'en']]}>
      <Read />
    </ContextProvider>

    {/* Create an isolated scope that ignores parents */}
    <ContextProvider
      inherit={false}
      contexts={[
        [Theme, 'light'],
        [Lang, 'en'],
      ]}
    >
      <Read />
    </ContextProvider>
  </ContextProvider>
));
```

| Prop     | Type                          | Description                         |
| -------- | ----------------------------- | ----------------------------------- |
| contexts | `[...ContextPair<unknown[]>]` | Contexts to provide                 |
| inherit  | `boolean`                     | Inherit parent scope (default true) |
| children | `React.ReactNode`             | Children                            |
