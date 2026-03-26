---
title: Entities
---

Entities are the foundation of Fetchium's data model. They provide **normalized, deduplicated data objects** that are shared across queries. When the same entity (same typename + id) is returned by multiple queries, they all share the same object reference -- meaning updates to an entity from any source are immediately visible everywhere.

---

## Defining an Entity

To define an entity, extend the `Entity` class and declare fields using the `t` type DSL. Every entity must have a `__typename` field (used to identify the entity type) and an `id` field marked with `t.id`.

```tsx
import { Entity, t } from 'fetchium';

class User extends Entity {
  __typename = t.typename('User');
  id = t.id;
  name = t.string;
  email = t.string;
  avatar = t.optional(t.string);
  createdAt = t.format('date-time');
}
```

Each field declares what type of data it holds:

| Field definition        | Description                                          |
| ----------------------- | ---------------------------------------------------- |
| `t.id`                  | The unique identifier (string or number)             |
| `t.typename('...')`     | The entity's type name, used for normalization       |
| `t.string`              | A string value                                       |
| `t.number`              | A numeric value                                      |
| `t.boolean`             | A boolean value                                      |
| `t.optional(...)`       | Wraps any type to allow `undefined`                  |
| `t.nullable(...)`       | Wraps any type to allow `null`                       |
| `t.format('date-time')` | A formatted value (e.g. ISO string parsed to `Date`) |
| `t.enum(...)`           | A set of allowed literal values                      |
| `t.array(...)`          | An array of a given type                             |
| `t.entity(...)`         | A reference to another entity                        |

---

## Entity Identity

Every entity is uniquely identified by the combination of its **typename** and **id**. The `__typename` field provides the type discriminator, and the `id` field (marked with `t.id`) provides the unique identifier within that type.

```tsx
class User extends Entity {
  __typename = t.typename('User');
  id = t.id; // The identity field
  name = t.string;
}

class Post extends Entity {
  __typename = t.typename('Post');
  id = t.id; // Separate identity namespace from User
  title = t.string;
}
```

{% callout %}
The `__typename` field is **required** on every entity. Fetchium uses it internally to route entities into the normalized cache. Without it, deduplication and cross-query sharing will not work.
{% /callout %}

---

## Identity-Stable Proxies

When Fetchium parses a query response, it does not return plain JavaScript objects for entities. Instead, it returns **Proxy objects** that are tied to the normalized entity store.

The key property of these proxies is **identity stability**: for any given `(typename, id)` pair, Fetchium always returns the **same proxy object**. This has several important consequences:

- **Reference equality across queries.** If `GetUser` and `GetPostWithAuthor` both return User #42, the `user` object in both results is the exact same proxy (`===`).
- **Automatic updates.** When an entity's data changes (from a refetch, mutation, or stream), the proxy reflects the new data immediately. Any component or reactive function reading from that proxy sees the update.
- **Safe to store in state.** You can save an entity proxy in local state or pass it as a prop. It will never go stale -- it always points to the latest data in the cache.

```tsx
// Two different queries returning the same user
const userResult = await fetchQuery(GetUser, { id: '1' });
const postResult = await fetchQuery(GetPostWithAuthor, { postId: '5' });

// If post #5's author is user #1, these are the exact same object
userResult.user === postResult.post.author; // true
```

{% callout type="warning" %}
Entity proxies are **read-only**. Attempting to set a property on an entity proxy will throw an error in development mode. To update entity data, use mutations or streaming updates.
{% /callout %}

---

## Reactive Property Access

Reading a property on an entity proxy **registers a reactive dependency**. This means that reactive functions and React components will automatically re-run or re-render only when the specific properties they access change.

```tsx {% mode="react" %}
import { useQuery } from 'fetchium/react';

function UserProfile() {
  const { user } = useQuery(GetUser, { id: '1' });

  // This component only re-renders when `name` or `email` changes.
  // Changes to other fields (e.g. `avatar`) do not trigger a re-render.
  return (
    <div>
      <h1>{user.name}</h1>
      <p>{user.email}</p>
    </div>
  );
}
```

```tsx {% mode="signalium" %}
import { reactive } from 'signalium';
import { fetchQuery } from 'fetchium';
import { component } from 'signalium/react';

const UserProfile = component(() => {
  const { user } = fetchQuery(GetUser, { id: '1' });

  // This component only re-renders when `name` or `email` changes.
  // Changes to other fields (e.g. `avatar`) do not trigger a re-render.
  return (
    <div>
      <h1>{user.name}</h1>
      <p>{user.email}</p>
    </div>
  );
});
```

Under the hood, each entity proxy consumes a `Notifier` signal when a property is read. When the entity's data is updated, the notifier fires, and only the reactive computations that read from that entity are re-evaluated.

---

## Nested Entities

Entities can reference other entities using `t.entity(EntityClass)`. Nested entities are also normalized and deduplicated -- they follow all the same rules as top-level entities.

```tsx
class Comment extends Entity {
  __typename = t.typename('Comment');
  id = t.id;
  body = t.string;
  author = t.entity(User);
}

class Post extends Entity {
  __typename = t.typename('Post');
  id = t.id;
  title = t.string;
  body = t.string;
  author = t.entity(User);
  comments = t.array(t.entity(Comment));
}
```

In this example, if a `Post` and one of its `Comment`s reference the same `User`, both `post.author` and `comment.author` will be the same proxy object. Updating that user's name via any query will update it in both places.

```tsx
class GetPost extends RESTQuery {
  params = { id: t.id };
  path = `/posts/${this.params.id}`;
  result = { post: t.entity(Post) };
}

// After fetching:
const post = result.post;
const firstComment = post.comments[0];

// If the post author and first comment author are the same user:
post.author === firstComment.author; // true
post.author.name; // "Alice"
firstComment.author.name; // "Alice" (same object)
```

---

## Entity Methods

You can define methods directly on entity classes. Methods have access to the entity's fields via `this` and are automatically wrapped with `reactiveMethod` for memoization -- meaning the same arguments produce the same result without recomputation.

```tsx
class User extends Entity {
  __typename = t.typename('User');
  id = t.id;
  firstName = t.string;
  lastName = t.string;
  age = t.number;

  get fullName() {
    return `${this.firstName} ${this.lastName}`;
  }

  greet() {
    return `Hello, ${this.name}!`;
  }

  isAdult() {
    return this.age >= 18;
  }
}
```

Methods work on entity proxies just like regular methods:

```tsx
const user = result.user;
user.fullName; // "Alice Smith"
user.greet(); // "Hello, Alice!"
user.isAdult(); // true
```

{% callout %}
Entity methods defined as class methods (not getters) are wrapped with `reactiveMethod`, which caches their return values reactively. Getters are evaluated each time they are accessed but still establish reactive dependencies on the entity's fields.
{% /callout %}

---

## Entity Cache Configuration

You can control how long unused entities stay in memory using the static `cache` property on the entity class. The `gcTime` option specifies the number of **minutes** an entity remains in the cache after it is no longer referenced by any active query.

```tsx
class User extends Entity {
  static cache = { gcTime: 5 }; // Keep in cache for 5 minutes after last use

  __typename = t.typename('User');
  id = t.id;
  name = t.string;
}
```

| `gcTime` value        | Behavior                                                             |
| --------------------- | -------------------------------------------------------------------- |
| `undefined` (default) | Entity is evicted immediately when no queries reference it           |
| `0`                   | Entity is evicted on the next tick                                   |
| `5`                   | Entity stays in cache for 5 minutes after last reference is released |
| `Infinity`            | Entity is never garbage collected                                    |

{% callout %}
Cache configuration is set at the entity class level, not per-query. All instances of `User` share the same GC policy.
{% /callout %}

---

## Deduplication in Practice

One of the most powerful features of Fetchium's entity system is automatic deduplication. Here is a concrete example showing how it works across multiple queries.

Consider a social feed where you fetch a list of posts and also fetch individual user profiles:

```tsx
class User extends Entity {
  __typename = t.typename('User');
  id = t.id;
  name = t.string;
  avatar = t.string;
}

class Post extends Entity {
  __typename = t.typename('Post');
  id = t.id;
  title = t.string;
  author = t.entity(User);
}

class GetFeed extends RESTQuery {
  path = '/feed';
  result = { posts: t.array(t.entity(Post)) };
}

class GetUser extends RESTQuery {
  params = { id: t.id };
  path = `/users/${this.params.id}`;
  result = { user: t.entity(User) };
}
```

```tsx {% mode="react" %}
function Feed() {
  const { posts } = useQuery(GetFeed);

  return (
    <div>
      {posts.map((post) => (
        <PostCard key={post.id} post={post} />
      ))}
    </div>
  );
}

function UserProfile() {
  const { user } = useQuery(GetUser, { id: '1' });

  // If user #1 also authored a post in the feed, this is the SAME proxy.
  // Updating the user's name here updates it in the feed too.
  return <h1>{user.name}</h1>;
}
```

```tsx {% mode="signalium" %}
const Feed = component(() => {
  const { posts } = fetchQuery(GetFeed);

  return (
    <div>
      {posts.map((post) => (
        <PostCard key={post.id} post={post} />
      ))}
    </div>
  );
});

const UserProfile = component(() => {
  const { user } = fetchQuery(GetUser, { id: '1' });

  // If user #1 also authored a post in the feed, this is the SAME proxy.
  // Updating the user's name here updates it in the feed too.
  return <h1>{user.name}</h1>;
});
```

If the feed response includes posts authored by User #1, and you also fetch User #1 directly via `GetUser`, both queries share the same `User` proxy. A mutation that updates User #1's name will be reflected in both the feed and the profile -- with no manual cache invalidation needed.

---

## Subscriptions

Entities can subscribe to real-time updates by defining a `__subscribe` method. When an entity proxy is actively being read by a reactive context (a component, a watcher, etc.), Fetchium will call `__subscribe` to establish a real-time connection.

```tsx
class User extends Entity {
  __typename = t.typename('User');
  id = t.id;
  name = t.string;
  email = t.string;

  __subscribe(onEvent) {
    // Connect to a WebSocket, SSE stream, or other real-time source
    const ws = new WebSocket(`/ws/users/${this.id}`);

    ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      onEvent({
        type: 'update',
        typename: 'User',
        data: { id: this.id, ...data },
      });
    };

    // Return a cleanup function
    return () => ws.close();
  }
}
```

The `__subscribe` method receives an `onEvent` callback. Call it with a mutation event whenever the entity changes. Fetchium will merge the update into the entity store, and all proxies will reflect the new data.

The cleanup function returned from `__subscribe` is called when the entity is no longer being actively observed (i.e., no components or watchers are reading it).

{% callout %}
The `__subscribe` method is only called when the entity is being actively consumed in a reactive context. If no component or reactive function is reading the entity's properties, the subscription will not be established (or will be torn down if it was previously active).
{% /callout %}

For more details on real-time streaming patterns, see the [Streaming guide](/reference/streaming).
