---
title: Providing context
---

Signalium has its own Context system for dependency injection into reactive code. From a React perspective, it works like React's `Context.Provider` — you wrap a subtree with a `ContextProvider` and descendants read values with `useContext`. Under the hood, it also integrates with the reactive graph so context-dependent reactive functions re-evaluate when the scope changes.

## Defining a context

```ts
import { context } from 'signalium';

export const Theme = context<'light' | 'dark'>('light');
```

`context(default)` creates a handle. The default is used whenever no provider is in scope.

## Providing a context

```tsx
import { component, ContextProvider } from 'signalium/react';
import { Theme } from './theme';

const App = component(({ children }) => (
  <ContextProvider contexts={[[Theme, 'dark']]}>
    {children}
  </ContextProvider>
));
```

`ContextProvider` takes a `contexts` prop: an array of `[context, value]` tuples. You can pass as many as you like in a single provider — no need to nest.

```tsx
<ContextProvider
  contexts={[
    [Theme, 'dark'],
    [Lang, 'es'],
    [User, currentUser],
  ]}
>
  <App />
</ContextProvider>
```

Flattening matters: every provider creates a new scope and re-evaluates reactive functions that depend on it. Fewer, wider providers are cheaper than many nested ones.

## Reading a context

```tsx
import { component, useContext } from 'signalium/react';
import { Theme } from './theme';

const Label = component(() => {
  const theme = useContext(Theme);
  return <span>Theme: {theme}</span>;
});
```

`useContext` works in both `component(...)` and regular hooks-based components, so you can share context definitions across the boundary.

## Reading a context from a reactive function

Reactive functions read context through `getContext` from the core package:

```ts
import { context, getContext, reactive } from 'signalium';

const Theme = context<'light' | 'dark'>('light');

const buttonClass = reactive(() =>
  getContext(Theme) === 'dark' ? 'btn-dark' : 'btn-light');
```

When the context value changes in a new scope, `buttonClass` re-evaluates in that scope.

## Overrides and isolation

You can override a context for a subtree. By default, unspecified contexts are inherited from the parent scope:

```tsx
<ContextProvider contexts={[[Theme, 'dark']]}>
  <Read />

  {/* Override Theme for this subtree, inherit everything else */}
  <ContextProvider contexts={[[Theme, 'light']]}>
    <Read />
  </ContextProvider>

  {/* Fully isolated — ignores outer contexts entirely */}
  <ContextProvider inherit={false} contexts={[[Theme, 'light']]}>
    <Read />
  </ContextProvider>
</ContextProvider>
```

`inherit={false}` is useful when you want a test harness or a portal-like subtree that should not inherit the surrounding app's configuration.

## When to use a context vs. a module-scoped signal

- **Module-scoped signal.** One value, shared globally, mutable from anywhere. Great for current user, theme toggle, feature flags.
- **Context.** Value varies by location in the tree, or you want test-time substitution (e.g. swapping a real `fetch` for a mock in a specific subtree).

If you just want "shared mutable state across the app," a plain signal is cheaper. Reach for context when you need *dependency injection* — different values for different branches.

## A practical pattern: injecting a client

```ts
import { context, getContext, reactive } from 'signalium';

export interface ApiClient {
  get(path: string): Promise<unknown>;
}

export const Api = context<ApiClient | null>(null);

export const loadUser = reactive(async (id: string) => {
  const api = getContext(Api);
  if (!api) throw new Error('ApiClient not provided');
  return api.get(`/users/${id}`);
});
```

```tsx
// At the app root
<ContextProvider contexts={[[Api, realClient]]}>
  <App />
</ContextProvider>

// In tests
<ContextProvider contexts={[[Api, mockClient]]}>
  <ProfileScreen id="42" />
</ContextProvider>
```

Same `loadUser`, different backing client. No props, no monkey-patching.

## Next steps

- [Contexts (reactivity)](/reactivity/contexts) — the full reference, including `reactiveMethod` and scope ownership.
- [Testing](/integrating/testing) — context-based test fixtures and mock injection.
