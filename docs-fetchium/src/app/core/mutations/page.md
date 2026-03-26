---
title: Mutations
---

Mutations represent write operations -- creating, updating, and deleting data on your server. Unlike queries, which are declarative and automatically cached, mutations are executed imperatively and do not cache their results. They are the primary mechanism for sending data back to the server in a Fetchium application.

---

## What is a Mutation?

A mutation models an HTTP write operation such as `POST`, `PUT`, `DELETE`, or `PATCH`. When you define a mutation, you describe:

- The **params** it accepts (the input from your application code)
- The **path** it sends the request to
- The **HTTP method** it uses
- The **body** of the request
- The **result** shape it expects back from the server

Mutations are class-based, extending either the low-level `Mutation` base class or the more convenient `RESTMutation` class for JSON APIs.

---

## Defining a Mutation

The most common way to define a mutation is by extending `RESTMutation`. This gives you automatic JSON serialization, content-type headers, and path interpolation out of the box.

```tsx
import { RESTMutation, t } from 'fetchium';

class CreateUser extends RESTMutation {
  params = { name: t.string, email: t.string };
  path = '/users';
  method = 'POST';
  body = { name: this.params.name, email: this.params.email };
  result = { id: t.number, name: t.string, email: t.string };
}
```

Each field uses the `t` type DSL to describe the shape of the data. The `params` field defines what values your application code passes in when executing the mutation. The `body` field defines the JSON payload sent to the server -- it can reference values from `params` using `this.params`.

{% callout %}
If you omit the `body` field, the entire `params` object is sent as the request body by default.
{% /callout %}

---

## Executing Mutations

Mutations are executed using the `getMutation()` function, which returns a reactive task function. You call this function with the mutation params to trigger the network request.

```tsx {% mode="react" %}
import { getMutation } from 'fetchium';

function CreateUserForm() {
  const createUser = getMutation(CreateUser);

  const handleSubmit = async (data) => {
    const result = await createUser.run({ name: data.name, email: data.email });
    console.log('Created:', result);
  };

  return <form onSubmit={handleSubmit}>...</form>;
}
```

```tsx {% mode="signalium" %}
import { getMutation } from 'fetchium';
import { component } from 'signalium/react';

const CreateUserForm = component(() => {
  const createUser = getMutation(CreateUser);

  const handleSubmit = async (data) => {
    const result = await createUser.run({ name: data.name, email: data.email });
    console.log('Created:', result);
  };

  return <form onSubmit={handleSubmit}>...</form>;
});
```

The object returned by `getMutation()` is a `ReactiveTask`. It exposes properties for tracking the mutation state:

| Property      | Type                          | Description                           |
| ------------- | ----------------------------- | ------------------------------------- |
| `run(params)` | `(params) => Promise<Result>` | Execute the mutation                  |
| `isPending`   | `boolean`                     | `true` while the request is in flight |
| `isResolved`  | `boolean`                     | `true` after the request succeeds     |
| `isRejected`  | `boolean`                     | `true` if the request failed          |
| `value`       | `Result \| undefined`         | The resolved result, if available     |
| `error`       | `Error \| undefined`          | The error, if the request failed      |

Because the task is reactive, reading `isPending`, `isResolved`, or `value` inside a reactive context (a `component()` or `reactive()` function) will automatically re-render when the mutation state changes.

---

## Mutation Path and Method

### Path interpolation

Path interpolation works the same as queries. Use bracket syntax to embed param values in the URL:

```tsx
class UpdateUser extends RESTMutation {
  params = { id: t.id, name: t.string };
  path = `/users/${this.params.id}`;
  method = 'PUT';
  body = { name: this.params.name };
  result = { id: t.number, name: t.string };
}
```

When executed with `{ id: '42', name: 'Alice' }`, the request is sent to `/users/42`.

### Default method

The default HTTP method for `RESTMutation` is `POST`. You can set it to `'POST'`, `'PUT'`, `'DELETE'`, or `'PATCH'`.

### Dynamic overrides

For cases where you need more control, `RESTMutation` supports dynamic override methods. These take precedence over the static field values:

| Method                | Overrides        | Description                                                         |
| --------------------- | ---------------- | ------------------------------------------------------------------- |
| `getPath()`           | `path`           | Dynamically compute the request URL                                 |
| `getMethod()`         | `method`         | Dynamically compute the HTTP method                                 |
| `getBody()`           | `body`           | Dynamically compute the request body                                |
| `getRequestOptions()` | `requestOptions` | Dynamically compute fetch options (e.g., `baseUrl`, custom headers) |

```tsx
class DynamicMutation extends RESTMutation {
  params = { id: t.id, data: t.object({ name: t.string }) };
  result = { id: t.number, name: t.string };

  getPath() {
    return `/api/v2/users/${this.params.id}`;
  }

  getMethod() {
    return 'PATCH';
  }

  getBody() {
    return this.params.data;
  }
}
```

---

## Mutation Effects

Effects let you automatically update your local entity cache after a mutation succeeds. This keeps your UI in sync without manually refetching queries.

Effects can fire three kinds of events:

| Effect type | Description                                                   |
| ----------- | ------------------------------------------------------------- |
| `creates`   | Adds new entities to the cache and notifies live collections  |
| `updates`   | Updates existing entity proxies in place                      |
| `deletes`   | Removes entities from the cache and notifies live collections |

### Static effects

Define effects directly on the mutation class using the `effects` property. Each entry is a tuple of `[EntityClass, data]`:

```tsx
import { Entity } from 'fetchium';

class User extends Entity {
  typename = 'User';
  id = t.id;
  name = t.string;
  email = t.string;
}

class UpdateUserName extends RESTMutation {
  params = { id: t.id, name: t.string };
  path = `/users/${this.params.id}`;
  method = 'PUT';
  body = { name: this.params.name };
  result = User;

  effects = {
    updates: [[User, { id: this.params.id, name: this.params.name }]],
  };
}
```

When this mutation succeeds, any `User` entity with the matching `id` is updated in the entity store. Components displaying that user will re-render automatically.

### Dynamic effects with `getEffects()`

For effects that depend on the server response, override the `getEffects()` method. Inside this method you have access to `this.params` (the input) and `this.result` (the parsed response):

```tsx
class CreatePost extends RESTMutation {
  params = { title: t.string, body: t.string };
  path = '/posts';
  method = 'POST';
  result = Post;

  getEffects() {
    return {
      creates: [[Post, this.result]],
    };
  }
}
```

{% callout %}
Effects are processed after the response is validated. If the mutation request fails, no effects are applied.
{% /callout %}

### How effects interact with live collections

When a mutation fires a `creates` event, any active live collection that matches the entity type will automatically include the new entity. Similarly, `deletes` events remove entities from matching live collections. This means your lists and feeds stay up to date without manual intervention.

---

## Optimistic Updates

Optimistic updates let you apply mutation effects immediately, before the server responds. This makes your UI feel instant.

Set `optimisticUpdates = true` on the mutation class:

```tsx
class ToggleLike extends RESTMutation {
  params = { postId: t.id, liked: t.boolean };
  path = `/posts/${this.params.postId}/like`;
  method = 'PUT';
  body = { liked: this.params.liked };
  result = Post;
  optimisticUpdates = true;

  effects = {
    updates: [[Post, { id: this.params.postId, liked: this.params.liked }]],
  };
}
```

When you execute this mutation:

1. The effects are applied to the entity store immediately
2. The network request is sent in the background
3. If the request succeeds, the optimistic data is replaced with the real server response
4. If the request fails, the optimistic changes are rolled back

{% callout type="warning" %}
Optimistic updates work best for simple, predictable changes (toggling a boolean, incrementing a counter). For complex mutations where the server may transform the data significantly, consider waiting for the real response instead.
{% /callout %}

{% callout type="warning" %}
If a mutation with optimistic updates fails, the rollback restores the entity to its previous state. Make sure your UI handles the error case gracefully -- for example, by showing a toast notification or retry button.
{% /callout %}

---

## Retry Configuration

By default, mutations do not retry on failure (unlike queries, which retry 3 times). You can configure retry behavior using the `config` property:

```tsx
class CreateUser extends RESTMutation {
  params = { name: t.string, email: t.string };
  path = '/users';
  method = 'POST';
  body = { name: this.params.name, email: this.params.email };
  result = { id: t.number, name: t.string, email: t.string };

  config = {
    retry: {
      retries: 3,
      retryDelay: (attempt) => 1000 * Math.pow(2, attempt),
    },
  };
}
```

The `retry` option accepts:

| Value                  | Behavior                                                     |
| ---------------------- | ------------------------------------------------------------ |
| `false`                | Never retry (default for mutations)                          |
| A number (e.g., `3`)   | Retry up to that many times with default exponential backoff |
| A `RetryConfig` object | Full control over retry count and delay strategy             |

The `RetryConfig` object has two fields:

- **`retries`** -- the maximum number of retry attempts
- **`retryDelay`** -- an optional function that receives the attempt index (starting at 0) and returns the delay in milliseconds. The default is exponential backoff: `1000 * 2^attempt`.

---

## Storage Keys

Every mutation has a storage key that uniquely identifies it. For `RESTMutation`, the default storage key is derived from the method and path:

```
POST:/users
PUT:/users/[id]
```

You can override this by implementing `getStorageKey()`:

```tsx
class CreateUser extends RESTMutation {
  params = { name: t.string, email: t.string };
  path = '/users';
  method = 'POST';
  result = { id: t.number, name: t.string, email: t.string };

  getStorageKey() {
    return 'create-user';
  }
}
```

The storage key is used internally to deduplicate mutation definitions. Two mutation classes with the same storage key will share the same underlying mutation instance within a `QueryClient`.

---

## Custom Mutations

If your API does not use JSON (for example, GraphQL or file uploads), you can extend the base `Mutation` class directly and implement the `send()` method:

```tsx
import { Mutation, t } from 'fetchium';

class UploadAvatar extends Mutation {
  params = { userId: t.id, file: t.any };
  result = { url: t.string };

  getStorageKey() {
    return 'upload-avatar';
  }

  async send() {
    const formData = new FormData();
    formData.append('file', this.params.file);

    const response = await this.context.fetch(
      `/users/${this.params.userId}/avatar`,
      {
        method: 'POST',
        body: formData,
        signal: this.signal,
      },
    );

    this.response = response;
    return response.json();
  }
}
```

Inside `send()`, you have access to:

- **`this.params`** -- the validated input params
- **`this.context`** -- the `QueryContext` with `fetch`, `log`, and `baseUrl`
- **`this.signal`** -- an `AbortSignal` for cancellation
- **`this.response`** -- set this to the raw `Response` object if you want to access it in `getEffects()`
