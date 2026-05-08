---
title: Contexts (reactivity)
---

A **context** is a piece of ambient data that reactive code can read without having it passed in explicitly. If you've used React's `Context` or dependency injection in other languages, the shape is familiar: declare the context with a default, provide a value for some scope, and read it from anywhere inside that scope.

```ts
import { context, getContext, withContexts, reactive } from 'signalium';

const ApiPrefix = context('/api/');

const getUsersUrl = reactive(() => {
  const prefix = getContext(ApiPrefix);
  return `${prefix}users`;
});

getUsersUrl(); // "/api/users"

withContexts([[ApiPrefix, '/api/v2/']], () => {
  getUsersUrl(); // "/api/v2/users"
});
```

Contexts in Signalium work outside of React. They're a reactive-first primitive: you can use them in a Node script, in a web worker, on a server, or anywhere signals work. The React integration layers `ContextProvider` and a React-aware `useContext` on top of the same underlying mechanism — see [Providing context](/components/contexts) for that side of the story.

## Why contexts?

Signalium is designed to be used in many places *beyond* the DOM. A reactive graph can run on the server, in a background task, in a web worker. That means "the tree" isn't always a DOM tree — it's a call graph. Functions call functions, and any one call might want to read some ambient configuration without it being threaded through every layer.

Contexts formalize this. They're the reactive equivalent of **implicit parameters**: extra inputs that a function has access to by virtue of *where it's called from*, not *what was passed to it*. Functional languages like Scala call these "contextual parameters"; Signalium calls them contexts.

Critically, contexts fit into [signal purity](/reactivity/reactive-functions#signal-purity). A reactive function's memoization key includes the contexts in scope, so "same arguments + same signals + same context" still maps to "same result". Signalium forks cached instances when contexts change, so values don't bleed between scopes.

## Defining a context

```ts
import { context } from 'signalium';

const ApiPrefix = context('/api/');
const Theme = context<'light' | 'dark'>('light');
const CurrentUser = context<User | null>(null);
```

The first argument is the default value — what `getContext(...)` returns when no explicit scope has set this context. A second argument is an optional debug description:

```ts
const ApiPrefix = context('/api/', 'api-prefix');
```

A context handle is opaque. You can't read its default out directly (that's what `getContext(ApiPrefix)` is for), and you can't mutate it. Think of it as a key into a lookup table; the table itself is the scope.

## Reading a context

Inside reactive code, use `getContext`:

```ts
import { reactive, getContext } from 'signalium';

const buildUrl = reactive((path: string) => {
  const prefix = getContext(ApiPrefix);
  return `${prefix}${path}`;
});
```

`getContext` walks from the current scope outward until it finds a value for the requested context, or returns the default if none was set. The read is tracked — if the context's value changes (by entering a different scope, or by the backing signal being written, see below), the reactive function re-runs.

`getContext` can also be called from *synchronous* non-reactive code, as long as you're inside a `withContexts` block. Outside of any scope, `getContext` returns the context's default.

## Scoping values with `withContexts`

`withContexts(pairs, fn)` runs `fn` with a set of context bindings active for its dynamic extent:

```ts
import { withContexts, context } from 'signalium';

const ApiPrefix = context('/api/');
const Theme = context<'light' | 'dark'>('light');

const result = withContexts(
  [
    [ApiPrefix, '/api/v2/'],
    [Theme, 'dark'],
  ],
  () => {
    // Any getContext(ApiPrefix) / getContext(Theme) in here
    // — or anything reactive called from here — sees these values.
    return computeSomething();
  },
);
```

The first argument is an array of `[context, value]` pairs — you can set multiple contexts in a single call, and any that aren't mentioned are inherited from whatever enclosing scope exists. `withContexts` returns whatever the inner function returns.

Scopes can nest:

```ts
withContexts([[ApiPrefix, '/api/v2/']], () => {
  // getContext(ApiPrefix) => "/api/v2/"
  withContexts([[ApiPrefix, '/api/v3/']], () => {
    // getContext(ApiPrefix) => "/api/v3/"
  });
  // getContext(ApiPrefix) => "/api/v2/" again
});
```

Leaving the block restores the previous binding.

## Contexts and reactive caching

Reactive functions memoize on their arguments and the signals they read — and, importantly, on the **scope** they're called in. Under the hood, every distinct combination of active contexts gives reactives a new cache slot.

```ts
const LogContext = context<string>('root');

const log = reactive(() => {
  console.log(getContext(LogContext));
});

log(); // logs 'root'
log(); // cached, no log

withContexts([[LogContext, 'child']], () => {
  log(); // logs 'child' — different scope, new cache slot
  log(); // cached, no log
});

log(); // still cached from the outer scope, no log
```

This is what makes the model compose safely. A reactive function behaves identically when called with the same inputs in the same scope — it's just that "scope" now includes context values in addition to arguments and signal state.

All contexts in a scope are treated collectively as a single memoization key. Overriding *any* context in a `withContexts` call creates a new scope, which means every reactive called from inside that scope gets a fresh cache slot — even reactives that don't read the overridden context. This is usually fine because contexts tend to be set once at the top of an application, but it's worth knowing if you dynamically override contexts deep in the call tree.

## Contexts as immutable bindings

A context binding is **immutable** for the duration of its scope. You don't "set" a context; you *enter a scope* where the context has some value. If you want a value that can change over time while the scope is still active, put a [signal](/reactivity/signals) *inside* the context:

```ts
import { context, signal, getContext, reactive, withContexts } from 'signalium';

const apiPrefix = signal('/api/');
const ApiPrefixCtx = context(apiPrefix);

const getUsersUrl = reactive(() => {
  const prefixSignal = getContext(ApiPrefixCtx);
  return `${prefixSignal.value}users`;
});

getUsersUrl(); // "/api/users"

apiPrefix.value = '/api/v2/';
getUsersUrl(); // "/api/v2/users" — the signal changed, the reactive re-ran

// If you want a completely separate prefix in some subtree, use a different
// signal (or a different default) in that scope:
const scopedPrefix = signal('/api/internal/');

withContexts([[ApiPrefixCtx, scopedPrefix]], () => {
  getUsersUrl(); // "/api/internal/users"
  scopedPrefix.value = '/api/internal/v2/';
  getUsersUrl(); // "/api/internal/v2/users"
});
```

This pattern — "context holds a signal" — is the standard shape for dependency-injected reactive state. The context provides the *identity* of the dependency; the signal provides the *value* that can change.

## Contexts as dependency injection

The most common use case for contexts in Signalium is dependency injection: an API client, a database handle, a logger, a feature-flag service — anything that's fundamentally global-ish but that you want to be able to swap out for tests, alternate environments, or parts of your app.

```ts
import { context, getContext, reactive } from 'signalium';

interface ApiClient {
  get<T>(path: string): Promise<T>;
}

const ApiClientCtx = context<ApiClient | null>(null, 'api-client');

const loadUser = reactive(async (id: string) => {
  const api = getContext(ApiClientCtx);
  if (!api) throw new Error('No ApiClient configured');
  return api.get<User>(`/users/${id}`);
});
```

At the entry point of your app you install a real client:

```ts
import { withContexts } from 'signalium';

withContexts([[ApiClientCtx, new RealApiClient()]], () => {
  // entire app runs in here
});
```

In a test you install a fake:

```ts
withContexts([[ApiClientCtx, new FakeApiClient()]], () => {
  // test runs in here
});
```

Nothing in the reactive code had to change. It reads `ApiClientCtx` and gets whatever was installed.

For apps that want a single global binding without nesting every call inside `withContexts`, there's also `setGlobalContexts` — it installs a top-level scope once at startup. See the [API reference](/api/signalium) for details.

## Contexts for class instances

When reactive logic lives on a class and you want that class's methods to stay tied to the scope they were created in — not the scope they're called from — use [`reactiveMethod`](/reactivity/reactive-functions#reactivemethod) instead of `reactive`. This is especially important when contexts are used for global state that shouldn't be overridden by child scopes.

```ts
import { context, reactiveMethod, getContext } from 'signalium';

const SettingsCtx = context({ factor: 2 });

class Calculator {
  compute = reactiveMethod(this, (x: number) => {
    return x * getContext(SettingsCtx).factor;
  });
}
```

A `Calculator` created in a scope with `factor: 2` will always read `factor: 2`, even if called from a nested scope with a different value. That's often what you want for class-based stores.

## Relationship to React contexts

`signalium/react` provides `ContextProvider` and its own `useContext` that wrap the same underlying system:

- `ContextProvider contexts={[[ApiPrefixCtx, '/api/v2/']]}>` is the React equivalent of wrapping in `withContexts([[ApiPrefixCtx, '/api/v2/']], ...)`.
- `useContext(ApiPrefixCtx)` inside a `component(...)` reads the context through React's tree.
- Reactive functions called from a component automatically see the contexts provided by any enclosing `ContextProvider`.

You can use both sides — plain `withContexts` at module boundaries, `ContextProvider` inside components — and they compose cleanly. The full story for the React side is on the [Providing context](/components/contexts) page.

## Next steps

- [Providing context in React](/components/contexts) — the `ContextProvider` / `useContext` layer.
- [Reactive functions](/reactivity/reactive-functions) — how contexts interact with memoization and signal purity.
- [`reactiveMethod`](/reactivity/reactive-functions#reactivemethod) — scoping to an owner instead of a call site.
- [`context` and friends in the API reference](/api/signalium#context)
