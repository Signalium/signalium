---
title: Why Signalium?
---

Fetchium works great with plain React hooks via `useQuery`. You can use it in any function component without learning anything about signals or reactive programming. But Fetchium is built on [Signalium](https://signaliumjs.dev), and opting into Signalium's reactive model unlocks additional capabilities --- automatic memoization, reactive composition, fine-grained reactivity, and natural async/await support.

This page explains what you gain by using Signalium's reactive primitives alongside Fetchium, and when it makes sense to reach for them.

---

## Two Modes

Fetchium supports two approaches to data fetching. You can use either one, or mix them in the same application.

### React hooks mode

Use `useQuery` inside regular function components. This is the simplest approach and works with existing React patterns, state management, and component libraries.

```tsx
import { useQuery } from 'fetchium/react';

function UserProfile({ userId }: { userId: number }) {
  const user = useQuery(GetUser, { id: userId });

  return (
    <div>
      <h1>{user.name}</h1>
      <p>{user.email}</p>
    </div>
  );
}
```

This mode gives you automatic caching, deduplication, entity normalization, and live data --- all the core Fetchium features. For many applications, this is all you need.

### Signalium mode

Wrap your components with `component()` from Signalium and use `fetchQuery()` directly. This gives you full reactive composition, automatic memoization, and fine-grained dependency tracking.

```tsx
import { component } from 'signalium/react';
import { fetchQuery } from 'fetchium';

const UserProfile = component(({ userId }: { userId: number }) => {
  const user = fetchQuery(GetUser, { id: userId });

  return (
    <div>
      <h1>{user.name}</h1>
      <p>{user.email}</p>
    </div>
  );
});
```

The difference is subtle in simple cases, but becomes significant as your data requirements grow.

---

## What Signalium Adds

### Automatic memoization

Signalium's `component()` wrapper automatically memoizes your component. It only re-renders when the specific reactive values it reads actually change --- not on every parent re-render.

With standard React, parent re-renders cascade to all children unless you manually wrap components in `React.memo` and memoize props with `useMemo` and `useCallback`. With Signalium, this optimization is automatic:

```tsx
// This component only re-renders when `user.name` or `user.email` changes.
// Parent re-renders are ignored unless they change the `userId` prop.
const UserProfile = component(({ userId }: { userId: number }) => {
  const user = fetchQuery(GetUser, { id: userId });

  return (
    <div>
      <h1>{user.name}</h1>
      <p>{user.email}</p>
    </div>
  );
});
```

This is especially valuable in list views and deeply nested component trees, where unnecessary re-renders are a common performance problem.

### Reactive composition

With `fetchQuery()` directly, you can compose queries inside reactive functions that live **outside** of components:

```tsx
import { reactive } from 'signalium';
import { fetchQuery } from 'fetchium';

const getUserWithPosts = reactive((userId: number) => {
  const user = fetchQuery(GetUser, { id: userId });
  const posts = fetchQuery(GetUserPosts, { userId });
  return { user, posts };
});
```

This reactive function is **cached and shared**. If multiple components call `getUserWithPosts(42)`, they all read from the same cached computation. The queries are deduplicated, and the derived result is computed once.

This is powerful for building a **data layer** that sits between your API and your components:

```tsx
// data/user.ts --- shared reactive data layer
import { reactive } from 'signalium';
import { fetchQuery } from 'fetchium';

export const getFullUser = reactive((userId: number) => {
  const user = fetchQuery(GetUser, { id: userId });
  const posts = fetchQuery(GetUserPosts, { userId });
  const followers = fetchQuery(GetFollowers, { userId });

  return {
    user,
    posts,
    followers,
    postCount: posts.length,
    isPopular: followers.length > 1000,
  };
});

// components/UserProfile.tsx
const UserProfile = component(({ userId }: { userId: number }) => {
  const { user, isPopular } = getFullUser(userId);

  return (
    <div>
      <h1>
        {user.name} {isPopular ? '(Popular)' : ''}
      </h1>
    </div>
  );
});

// components/UserPosts.tsx
const UserPosts = component(({ userId }: { userId: number }) => {
  const { posts, postCount } = getFullUser(userId);

  return (
    <div>
      <h2>{postCount} Posts</h2>
      {posts.map((post) => (
        <PostCard key={post.id} post={post} />
      ))}
    </div>
  );
});
```

Both components call `getFullUser(userId)`, but the queries execute only once. The reactive function caches its result and returns the same object to all consumers.

### Fine-grained reactivity

Fetchium entities are reactive Proxy objects. When you access a property on an entity, Signalium tracks that access as a dependency. Only the specific properties your component reads trigger re-renders.

```tsx
const UserAvatar = component(({ userId }: { userId: number }) => {
  const user = fetchQuery(GetUser, { id: userId });

  // Only reads `avatarUrl` --- changes to `name`, `email`, etc. do NOT
  // cause this component to re-render
  return <img src={user.avatarUrl} />;
});

const UserName = component(({ userId }: { userId: number }) => {
  const user = fetchQuery(GetUser, { id: userId });

  // Only reads `name` --- changes to `avatarUrl`, `email`, etc. do NOT
  // cause this component to re-render
  return <span>{user.name}</span>;
});
```

Both components fetch the same user entity (deduplicated by the cache), but they re-render independently based on which properties they actually read. If a mutation updates `user.name`, only `UserName` re-renders. `UserAvatar` is unaffected.

This property-level tracking works automatically through Signalium's reactive system. There is no need to select specific fields or use selector functions.

### Async/await support

Signalium's Babel transform rewrites `async` reactive functions to use generators internally, enabling pause/resume semantics. This lets you `await` reactive promises naturally --- including query results:

```tsx
import { reactive } from 'signalium';
import { fetchQuery } from 'fetchium';

const getUserProfile = reactive(async (userId: number) => {
  const user = await fetchQuery(GetUser, { id: userId });
  const posts = await fetchQuery(GetUserPosts, { userId: user.id });

  // Sequential fetch: posts depend on the user's ID from the first query
  return { user, posts };
});
```

Without the transform, reactive functions are synchronous and return `ReactivePromise` objects. With the transform, you can write natural async/await code that Signalium converts into reactive computations behind the scenes. Dependencies are still tracked automatically, and the result updates when upstream data changes.

{% callout %}
The async transform requires the Signalium Babel preset. See [Babel Transform Setup](#babel-transform-setup) below for configuration.
{% /callout %}

---

## When to Use Which

Start with **React hooks mode** (`useQuery`). It is simpler, requires no build configuration, and covers the majority of use cases.

Consider **Signalium mode** when you need:

- **Cross-component reactive composition** --- multiple components sharing derived data from the same set of queries, without redundant computation or manual memoization.
- **Derived queries** --- queries whose parameters depend on the results of other queries (e.g., fetching a user's posts after fetching the user).
- **Fine-grained render optimization** --- large lists or complex UIs where property-level reactivity significantly reduces unnecessary re-renders.
- **Shared reactive computations** --- business logic that combines multiple data sources into a single reactive value, consumed by many parts of the UI.

You do not need to choose one mode for your entire application. It is common to use `useQuery` for simple data fetching in most components and reach for `component()` + `fetchQuery()` in performance-sensitive areas or where reactive composition simplifies the code.

---

## Incremental Adoption

Adopting Signalium is incremental. You do not need to rewrite your application.

### Step 1: Wrap components with `component()`

The simplest first step is wrapping existing components with `component()`. This gives you automatic memoization with zero other changes:

```tsx
// Before
function UserList({ users }: { users: User[] }) {
  return (
    <ul>
      {users.map((u) => (
        <li key={u.id}>{u.name}</li>
      ))}
    </ul>
  );
}

// After --- automatic memoization, no other changes needed
const UserList = component(({ users }: { users: User[] }) => {
  return (
    <ul>
      {users.map((u) => (
        <li key={u.id}>{u.name}</li>
      ))}
    </ul>
  );
});
```

### Step 2: Extract shared reactive functions

When you notice multiple components fetching the same data or computing the same derived values, extract a `reactive()` function:

```tsx
// Shared across components
const getDashboardData = reactive((orgId: string) => {
  const org = fetchQuery(GetOrg, { id: orgId });
  const members = fetchQuery(GetMembers, { orgId });
  const projects = fetchQuery(GetProjects, { orgId });

  return { org, members, projects };
});
```

### Step 3: Use async reactive functions for complex flows

For data flows where queries depend on each other, add the Babel transform and use async/await:

```tsx
const getProjectDetails = reactive(async (projectId: string) => {
  const project = await fetchQuery(GetProject, { id: projectId });
  const owner = await fetchQuery(GetUser, { id: project.ownerId });
  const tasks = await fetchQuery(GetTasks, { projectId });

  return { project, owner, tasks };
});
```

---

## Babel Transform Setup

The Signalium Babel transform is needed for async reactive functions. It rewrites `async` functions used with `reactive()` into generator-based coroutines that Signalium can pause and resume.

### Installation

The transform is included in the `signalium` package. No additional dependencies are needed.

### Configuration

Add the Signalium preset to your Babel configuration:

```js
// babel.config.js
module.exports = {
  presets: ['signalium/transform'],
};
```

If you are using other Babel presets (e.g., for React or TypeScript), add `signalium/transform` alongside them:

```js
// babel.config.js
module.exports = {
  presets: [
    '@babel/preset-react',
    '@babel/preset-typescript',
    'signalium/transform',
  ],
};
```

### What the transform does

The transform applies three rewrites:

1. **Async transform** --- rewrites `async` functions passed to `reactive()` into generators, enabling Signalium to track dependencies across `await` boundaries.
2. **Callback transform** --- wraps callback arguments in `callback()` for reactive tracking inside event handlers and closures.
3. **Promise methods transform** --- replaces `Promise.all`, `Promise.race`, and related methods with `ReactivePromise` equivalents, so concurrent data fetching integrates with the reactive system.

{% callout %}
The transform only affects code that uses Signalium APIs (`reactive`, `relay`, `task`, etc.). It does not modify unrelated async functions or Promise usage. Standard async/await outside of reactive contexts is untouched.
{% /callout %}

### Without the transform

If you prefer not to use a Babel transform, you can still use Signalium --- you just cannot use `async`/`await` inside reactive functions. Instead, access `ReactivePromise` values directly:

```tsx
const getUserProfile = reactive((userId: number) => {
  const userPromise = fetchQuery(GetUser, { id: userId });
  const postsPromise = fetchQuery(GetUserPosts, { userId });

  // Access .value on the reactive promise (returns undefined while loading)
  const user = userPromise.value;
  const posts = postsPromise.value;

  if (!user || !posts) return undefined;

  return { user, posts };
});
```

This approach works without any build tooling but requires manual handling of loading states.

---

## Getting Started with Signalium

For a deeper understanding of Signalium's reactive programming model --- including signals, reactive functions, relays, watchers, and contexts --- see the [Signalium documentation](https://signaliumjs.dev).

Key concepts to explore:

- **Signals** --- mutable state primitives (`signal()`)
- **Reactive functions** --- derived computations that automatically track dependencies (`reactive()`)
- **Relays** --- async computations with lifecycle management (`relay()`)
- **Watchers** --- side-effect subscriptions to reactive values (`watcher()`)
- **Contexts** --- dependency-injection-style scoping (`context()`, `getContext()`)

Fetchium's `fetchQuery()` returns a `ReactivePromise` (a Signalium async primitive), so understanding how Signalium handles async values will help you get the most out of the integration.
