---
title: React Integration
nextjs:
  metadata:
    title: React Integration
    description: Using Signalium with React
---

Signalium provides first-class integration with React through the `signalium/react` subpackage. This integration allows you to use signals directly in your React components while maintaining React's component model and lifecycle.

## A Basic Component

Signalium provides a `component` helper, which allows you to define a reactive component, and the `useSignal` hook, which allows you to define signals inside your component.

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

Components are memoized using the same rules as reactive functions, so they will only rerender when either:

1. The component's props differ _semi-deeply_ from the previous props (e.g. objects, arrays, and primitive values are deeply compared, but any kind of class instance that is not a plain object is compared via reference).
2. The signals that the component uses have been updated.

And any reactive functions that the component uses will rerun prior to the component being rendered.

### Using reactive functions in components

Reactive functions can be created and used in components just like normal functions, and they will update when the signals they depend on update.

```tsx
import { reactive } from 'signalium';

const doubled = reactive((count) => count.value * 2);

const Counter = component(() => {
  const count = useSignal(0);

  const doubled = reactive(() => count.value * 2);

  return (
    <div>
      <p>Count: {count.value}</p>
      <p>Doubled: {doubled()}</p>
      <button onClick={() => count.value++}>Increment</button>
    </div>
  );
});
```

You can also extract reactive functions out of components to make reusable functions, much like you would with custom hooks.

```tsx
import { reactive } from 'signalium';

const doubled = reactive((count: number) => count.value * 2);

const Counter = component(() => {
  const count = useSignal(0);

  return (
    <div>
      <p>Doubled: {doubled(count)}</p>
      <button onClick={() => count.value++}>Increment</button>
    </div>
  );
});
```

### Rules-of-Hooks vs Rules-of-Signals

Signalium components are fully compatible with React's own Hooks system. You can mix and match them as you please.

```tsx
import { useState, useMemo } from 'react';
import { component, useSignal } from 'signalium/react';

const Counter = component(() => {
  const [multiplier, setMultiplier] = useState(2);
  const count = useSignal(0);

  const multiplied = reactive(() => count.value * multiplier);

  return (
    <div>
      <p>Result: {multiplied()}</p>
      <button onClick={() => count.value++}>Increment</button>
      <button onClick={() => setMultiplier(multiplier + 1)}>
        Increment Multiplier
      </button>
    </div>
  );
});
```

However, when using _hooks_ inside of a component, including `useSignal`, you do still need to follow the Rules-of-Hooks. In addition, you _cannot_ use hooks inside of reactive functions.

```tsx
import { useState, useMemo } from 'react';
import { component, useSignal } from 'signalium/react';

const Counter = component(() => {
  const [multiplier, setMultiplier] = useState(2);

  const multiplied = reactive(() => {
    // 🛑 This is invalid! You cannot use hooks inside of reactive functions.
    const [count] = useState(0);

    return count * 2;
  });

  return (
    <div>
      <p>Result: {multiplied()}</p>
      <button onClick={() => setMultiplier(multiplier + 1)}>
        Increment Multiplier
      </button>
    </div>
  );
});
```

One of the major benefits of using signals over hooks is that you to don't need to follow the Rules-of-Hooks when using them directly inside of components. You can access signals and reactive functions conditionally, in any order, and they will still work as expected.

```tsx
import { reactive } from 'signalium';

const direction = signal<'up' | 'down'>('up');

const doubled = reactive((count: signal<number>) => count.value * 2);
const tripled = reactive((count: signal<number>) => count.value * 3);

const Doubled = component(() => {
  const count = useSignal(0);

  const result = direction.value === 'up' ? doubled(count) : tripled(count);

  return (
    <div>
      <p>Result: {result}</p>
      <button onClick={() => count.value++}>Increment</button>
    </div>
  );
});
```

`useSignal` is the one exception here, because it is essentially a wrapper around `useState` and integrates with React's state management system to provide persistence across renders. Just remember, if it's _named_ like a hook, it's still a hook, and still must follow the Rules-of-Hooks.

### State ownership

One key difference between standard React hooks and Signalium's reactive functions is that you cannot create state signals inside of reactive functions.

```tsx
import { reactive } from 'signalium';

const doubled = reactive((count: number) => {
  // 🛑 This is invalid! You cannot create state
  // signals inside of reactive functions.
  const count = useSignal(0);

  count.value * 2;
});

const Counter = component(() => {
  return (
    <div>
      <p>Doubled: {doubled(count)}</p>
      <button onClick={() => count.value++}>Increment</button>
    </div>
  );
});
```

The reason for this is that introducing state signals to reactive functions would break the signal purity guarantee, because state could logically _diverge_ based on the component you were contained within. You might want to create a new instance of a reactive function, or you might want to share the same instance across multiple components, and there is no way to easily differentiate if the reactive function creates and owns the state.

But, you _can_ create signals outside of reactive functions, and then use them inside of reactive functions, just like our example above. And one of the major benefits of passing signals around by reference is that it allows you to avoid excessive rerenders.

```tsx
import { reactive } from 'signalium';

const add = reactive(
  (a: Signal<number>, b: Signal<number>) => a.value + b.value,
);

const Sum = component(() => {
  const a = useSignal(1);
  const b = useSignal(2);

  return (
    <div>
      <p>Sum: {add(a, b)}</p>
      <button
        onClick={() => {
          a.value = 3;
          b.value = 0;
        }}
      >
        Change
      </button>
    </div>
  );
});
```

In this example, because we passed signals to the reactive function, it will rerun when those signals update. However, since the result of the function is the same, the component itself does not need to rerender.

Signals allow us to pass around state by reference, down through multiple levels of components and reactive functions, and then _only_ rerender the components that were actually affected by a change. This means you no longer need to use contexts just to avoid excessive rerenders due to props changes. The signal itself is stable, it's just the value that changes.

This is why Signalium takes the opinionated stance that if a function's output would be _different_ in two different components, then the _component_ should define the state and pass it to the function as a parameter. This defines clear state ownership and prevents functions from adding _implicit_ statefulness, maintaining signal purity.

## Async Data and Promises

Signalium's reactive promises work seamlessly with React components. However, there are some important things to note:

1. Reactive promises are always the same object instance, even when their value changes. This means that `React.memo` will not trigger a re-render when the promise's value updates:

```tsx
// This component will not re-render when the promise value changes
const MemoizedComponent = memo(({ promise }) => {
  return <div>{promise.value}</div>;
});

// Instead, use the value directly
const MemoizedComponent = memo(({ value }) => {
  return <div>{value}</div>;
});

function Parent() {
  const data = useReactive(getData); // returns a reactive promise
  return <MemoizedComponent value={data.value} />;
}
```

2. When using reactive promises in components, you can handle loading and error states:

```tsx
function DataComponent() {
  const data = useReactive(getData); // returns a reactive promise

  if (data.isPending) {
    return <div>Loading...</div>;
  }

  if (data.isRejected) {
    return <div>Error: {String(data.error)}</div>;
  }

  return <div>{data.value}</div>;
}
```

### Suspense and React Server Components

Because reactive promises implement the `Promise` interface, they can be used with `use`, `Suspense`, and React Server Components in general. In fact, the exact same reactive functions can be used on both the server and the client:

```tsx
// app/page.tsx
import { Suspense } from 'react';
import { ServerDataComponent } from './ui/server-data-component';
import { ClientDataComponent } from './ui/client-data-component';

export function App() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ServerDataComponent />
      <ClientDataComponent />
    </Suspense>
  );
}
```

```tsx
// app/ui/server-data-component.tsx
import { getData } from '../lib/query';

export async function ServerDataComponent() {
  const data = await getData();
  return <div>{data.value}</div>;
}
```

```tsx
// app/ui/client-data-component.tsx
import { use } from 'react';
import { component } from 'signalium/react';
import { getData } from '../lib/query';

export const ClientDataComponent = component(() => {
  const data = use(getData());

  return <div>{data.value}</div>;
}
```

```tsx
// app/lib/query.ts
import { reactive } from 'signalium';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const getData = reactive(() => {
  await sleep(1000);
  return 'Hello, world';
});
```

Because `getData` is an async reactive function, it will return a reactive promise which can be used with `use` to await the result on the client, or `await` on the server.

There are some caveats with using Signalium in RSCs at the moment:

1. While imports from `signalium` are fully supported on the server, the `signalium/react` subpackage is not currently as all of the helpers were designed specifically for clients. The plan moving forward is to implement alternative helpers for the server and use `module.exports` to specify which package to use in which environment, which is why we haven't just added `use client;` to the top of the files.
2. Reactive functions deduplicate results by default, which means that they will share state _across requests_ currently. This is dangerous behavior in general as you can leak state between requests, so for the moment they should only be used for values that are static across all requests. The plan here is to implement a mechanism based on `React.cache` to deduplicate results across requests allow Signalium contexts to be provided for each request.

## Contexts

Signalium's context system integrates with React's context system through the `ContextProvider` component:

```tsx
import { ContextProvider } from '@signalium/react';
import { createContext, state } from 'signalium';

const ThemeContext = createContext(signal('light'));

function App() {
  return (
    <ContextProvider contexts={[[ThemeContext, signal('dark')]]}>
      <YourApp />
    </ContextProvider>
  );
}

function ThemedComponent() {
  const theme = useContext(ThemeContext);
  return <div>Current theme: {theme.value}</div>;
}
```

Multiple contexts can be provided to the `ContextProvider` component, removing the need to nest many context providers in your component tree:

```tsx
<ContextProvider
  contexts={[
    [ThemeContext, signal('dark')],
    [OtherContext, signal('foo')],
  ]}
>
  <YourApp />
</ContextProvider>
```
