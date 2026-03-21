---
title: Getting started
---

Fetchium is a reactive data-fetching library built on [Signalium](/reference/why-signalium). It gives you class-based query definitions, automatic entity normalization and caching, a type DSL for describing API shapes, and first-class React integration --- all driven by Signalium's fine-grained reactivity engine.

With Fetchium you define your API surface as plain classes. The library handles fetch deduplication, caching, staleness, background refetching, offline support, and entity identity so your components stay simple and your data stays consistent.

---

## Quick Start Guide {% #getting-started %}

### 1. Install the packages

```bash
# Using npm
npm install fetchium signalium

# Using yarn
yarn add fetchium signalium

# Using pnpm
pnpm add fetchium signalium
```

### 2. Setup the Babel transform

Signalium requires a Babel transform to enable async reactivity. Add it to your bundler config so that async dependency tracking works correctly.

#### Vite + React

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { signaliumPreset } from 'signalium/transform';

export default defineConfig({
  plugins: [
    react({
      babel: {
        presets: [signaliumPreset()],
      },
    }),
  ],
});
```

#### babel.config.js

```js
import { signaliumPreset } from 'signalium/transform';

module.exports = {
  presets: [
    '@babel/preset-env',
    '@babel/preset-react',
    '@babel/preset-typescript',
    signaliumPreset(),
  ],
};
```

### 3. Create a QueryClient and wrap your app

Every Fetchium app needs a `QueryClient` backed by a store. The client manages query instances, the entity cache, and network state. Wrap your component tree in a `ContextProvider` so that queries can find the client.

```tsx
import { QueryClient, QueryClientContext } from 'fetchium';
import { SyncQueryStore, MemoryPersistentStore } from 'fetchium/stores/sync';
import { ContextProvider } from 'signalium/react';

const store = new SyncQueryStore(new MemoryPersistentStore());
const client = new QueryClient(store, { fetch });

function App() {
  return (
    <ContextProvider value={client} context={QueryClientContext}>
      <YourApp />
    </ContextProvider>
  );
}
```

{% callout title="Store choices" type="note" %}
`MemoryPersistentStore` keeps cached data in memory only --- it is great for getting started and for tests. For production apps that need offline persistence, use `IndexedDBPersistentStore` from `fetchium/stores/async` instead.
{% /callout %}

### 4. Define an Entity and a Query

Entities describe the shape of your API resources. Queries describe how to fetch them. Both use the `t` type DSL for field definitions.

```tsx
import { RESTQuery, t, Entity } from 'fetchium';

class User extends Entity {
  id = t.id;
  name = t.string;
  email = t.string;
}

class GetUser extends RESTQuery {
  params = { id: t.number };
  path = '/users/[id]';
  result = User;
}
```

`t.id` marks the identity field used for entity normalization. `path` supports bracket-based interpolation --- `[id]` is replaced with the `id` param at fetch time.

### 5. Use the query in a component

```tsx {% mode="react" %}
import { useQuery } from 'fetchium/react';

function UserProfile({ userId }: { userId: number }) {
  const user = useQuery(GetUser, { id: userId });

  if (!user.isReady) return <div>Loading...</div>;
  if (user.isRejected) return <div>Error: {user.error.message}</div>;

  return (
    <div>
      <h1>{user.value.name}</h1>
      <p>{user.value.email}</p>
    </div>
  );
}
```

```tsx {% mode="signalium" %}
import { fetchQuery } from 'fetchium';
import { component } from 'signalium/react';

const UserProfile = component(({ userId }: { userId: number }) => {
  const user = fetchQuery(GetUser, { id: userId });

  if (!user.isReady) return <div>Loading...</div>;
  if (user.isRejected) return <div>Error: {user.error.message}</div>;

  return (
    <div>
      <h1>{user.value.name}</h1>
      <p>{user.value.email}</p>
    </div>
  );
});
```

Both approaches return a `QueryPromise` with reactive properties like `value`, `error`, `isPending`, `isReady`, `isResolved`, and `isRejected`. The component re-renders automatically when the query state changes.

---

## Learn More

{% quick-links %}

{% quick-link title="Queries" icon="presets" href="/core/queries" description="Learn how to define queries, configure caching, and fetch data" /%}

{% quick-link title="Entities" icon="plugins" href="/core/entities" description="Understand normalized entity caching and identity-stable proxies" /%}

{% quick-link title="Live Data" icon="installation" href="/core/live-data" description="Keep your UI in sync with live arrays and real-time updates" /%}

{% quick-link title="Mutations" icon="theming" href="/core/mutations" description="Create, update, and delete data with optimistic updates" /%}

{% /quick-links %}

## Key Features

- **Class-based query definitions** --- Describe your API as plain TypeScript classes with full type inference
- **Automatic entity normalization** --- Entities with the same type and ID share a single cache entry, so updates propagate everywhere
- **Type DSL** --- `t.string`, `t.entity(User)`, `t.array(...)` and more for declaring params, results, and entity shapes
- **Fine-grained reactivity** --- Built on Signalium, so only the components that depend on changed data re-render
- **Caching and staleness** --- Configurable `staleTime`, `gcTime`, retry logic, and network modes per query class
- **Offline support** --- Persistent stores and offline-first network modes keep your app working without a connection
- **React integration** --- `useQuery` hook or Signalium's `component()` wrapper --- your choice
