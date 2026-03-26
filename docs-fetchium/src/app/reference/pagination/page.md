---
title: Pagination & Infinite Queries
---

Fetchium supports cursor-based, offset-based, and URL-based pagination through the `loadNext` configuration on queries. When `loadNext` is configured, the query result exposes `__loadNext()`, `__hasNext`, and `__isLoadingNext` --- giving you everything you need to build infinite scroll, "load more" buttons, and paginated lists.

---

## How Pagination Works

Pagination in Fetchium is declarative. You define how to fetch the next page on your query class, and Fetchium handles the rest: resolving cursor values from the current response, executing the next-page request, and merging results.

The flow is:

1. Initial query fetches the first page.
2. The response includes pagination metadata (a cursor, an offset, or a next URL).
3. `__loadNext()` reads the pagination metadata from the current result, constructs the next request, and fetches it.
4. Results are merged --- live arrays **append** new entities, while plain arrays are **replaced**.
5. The pagination metadata is updated to reflect the new response, so the next `__loadNext()` call fetches the correct page.

---

## Configuring Pagination

Add a `loadNext` field to your `RESTQuery` class. It accepts two optional properties:

| Property       | Type                      | Description                                           |
| -------------- | ------------------------- | ----------------------------------------------------- |
| `url`          | `string` or FieldRef      | Override the URL for the next page request            |
| `searchParams` | `Record<string, unknown>` | Search parameters to append. Values can be FieldRefs. |

### Cursor-based pagination

The most common pattern. Your API returns a cursor in the response body, and you pass it as a search param on the next request.

```tsx
import { RESTQuery, t, Entity } from 'fetchium';

class Item extends Entity {
  __typename = t.typename('Item');
  id = t.id;
  name = t.string;
}

class GetItems extends RESTQuery {
  path = '/items';
  result = {
    items: t.liveArray(Item),
    nextCursor: t.optional(t.string),
  };
  loadNext = {
    searchParams: {
      cursor: this.result.nextCursor,
    },
  };
}
```

The value `this.result.nextCursor` is a **field reference** (FieldRef). At runtime, when `__loadNext()` is called, Fetchium resolves the FieldRef against the current result data. If the first response returned `{ nextCursor: 'abc123' }`, the next request will include `?cursor=abc123`.

### Offset-based pagination

For APIs that use page numbers or offsets:

```tsx
class GetItems extends RESTQuery {
  path = '/items';
  result = {
    items: t.array(t.string),
    nextPage: t.optional(t.number),
    limit: t.number,
  };
  loadNext = {
    searchParams: {
      page: this.result.nextPage,
      limit: this.result.limit,
    },
  };
}
```

Multiple FieldRefs can be used in the same `searchParams` object. Each is resolved independently against the current result data.

### URL-based pagination

Some APIs return a full URL for the next page. Use the `url` property instead of `searchParams`:

```tsx
class GetItems extends RESTQuery {
  path = '/items';
  result = {
    items: t.array(t.string),
    nextUrl: t.optional(t.string),
  };
  loadNext = {
    url: this.result.nextUrl,
  };
}
```

When `__loadNext()` is called, Fetchium fetches the resolved URL directly instead of constructing one from the original path and search params.

---

## Dynamic Pagination with `getLoadNext()`

For cases where the pagination logic depends on runtime conditions --- response headers, error codes, or computed values --- override `getLoadNext()` instead of using the static `loadNext` field.

```tsx
class GetItems extends RESTQuery {
  path = '/items';
  result = { items: t.array(t.string), total: t.number };

  getLoadNext() {
    // Use a page token from response headers if available
    const pageToken = this.response?.headers?.get?.('X-Next-Page-Token');

    if (pageToken) {
      return { searchParams: { pageToken } };
    }

    // Fall back to offset-based pagination
    return { searchParams: { offset: 1 } };
  }
}
```

`getLoadNext()` has access to `this.response` (the raw `Response` object from the previous fetch) and `this.params` (the query params). It should return a `LoadNextConfig` object or `undefined`.

### Return `undefined` to disable pagination

If `getLoadNext()` returns `undefined`, `__hasNext` will be `false` and `__loadNext()` will throw. Use this to conditionally disable pagination:

```tsx
class GetItems extends RESTQuery {
  path = '/items';
  result = {
    items: t.array(t.string),
    hasMore: t.boolean,
    nextPage: t.optional(t.number),
  };

  getLoadNext() {
    // Only allow pagination on successful responses
    if (this.response?.status !== 200) {
      return undefined;
    }
    return { searchParams: { page: 2 } };
  }
}
```

### Priority: `getLoadNext()` overrides `loadNext`

When both a static `loadNext` field and a `getLoadNext()` method are defined, the method takes priority. The static field is ignored.

---

## Using Pagination in Components

```tsx {% mode="react" %}
import { useQuery } from 'fetchium/react';

function ItemList() {
  const query = useQuery(GetItems);

  if (query.isPending) return <div>Loading...</div>;

  const result = query.value;

  return (
    <div>
      <ul>
        {result.items.map((item) => (
          <li key={item.id}>{item.name}</li>
        ))}
      </ul>

      {result.__hasNext && (
        <button
          onClick={() => result.__loadNext()}
          disabled={result.__isLoadingNext}
        >
          {result.__isLoadingNext ? 'Loading...' : 'Load More'}
        </button>
      )}
    </div>
  );
}
```

```tsx {% mode="signalium" %}
import { fetchQuery } from 'fetchium';
import { component } from 'signalium/react';

const ItemList = component(() => {
  const query = fetchQuery(GetItems);

  if (query.isPending) return <div>Loading...</div>;

  const result = query.value;

  return (
    <div>
      <ul>
        {result.items.map((item) => (
          <li key={item.id}>{item.name}</li>
        ))}
      </ul>

      {result.__hasNext && (
        <button
          onClick={() => result.__loadNext()}
          disabled={result.__isLoadingNext}
        >
          {result.__isLoadingNext ? 'Loading...' : 'Load More'}
        </button>
      )}
    </div>
  );
});
```

### Headless usage (outside React)

```tsx
import { fetchQuery } from 'fetchium';

const relay = fetchQuery(GetItems);
await relay;

console.log(relay.value.items); // First page items

if (relay.value.__hasNext) {
  await relay.value.__loadNext();
  console.log(relay.value.items); // Updated items (appended for live arrays)
}
```

---

## QueryResult Pagination Properties

When `loadNext` is configured on a query, the query result object gains three additional properties:

| Property          | Type            | Description                                                                     |
| ----------------- | --------------- | ------------------------------------------------------------------------------- |
| `__loadNext()`    | `() => Promise` | Fetches the next page. Returns a promise that resolves when the page is loaded. |
| `__hasNext`       | `boolean`       | Whether more pages are available.                                               |
| `__isLoadingNext` | `boolean`       | Whether a next-page request is currently in flight.                             |

All three properties are **reactive** --- reading them inside a Signalium reactive function or a `component()` establishes a dependency, so your UI updates automatically when the values change.

### How `__hasNext` is determined

For **static `loadNext`** (with FieldRefs), `__hasNext` is `true` when all FieldRef values in the `searchParams` (or `url`) resolve to non-null, non-undefined values. When the API returns `nextCursor: undefined` or `nextCursor: null`, `__hasNext` becomes `false`.

For **`getLoadNext()`**, `__hasNext` is `true` when the method returns a non-undefined config object, and `false` when it returns `undefined`.

### Deduplication of concurrent calls

Calling `__loadNext()` multiple times concurrently returns the same promise. Only one network request is made per page --- subsequent calls while a request is in flight are deduplicated.

```tsx
// These are the same promise --- only one request is made
const p1 = result.__loadNext();
const p2 = result.__loadNext();
p1 === p2; // true
```

---

## Append Mode vs Replace Mode

The behavior when a new page is loaded depends on the type of array in your result:

### Live arrays (`t.liveArray`) --- append mode

New entities from the next page are **appended** to the existing array. The array accumulates across pages, giving you the classic infinite scroll behavior. Duplicate entities (same `typename + id`) are deduplicated --- the existing entry is updated in place rather than added again.

```tsx
class GetItems extends RESTQuery {
  path = '/items';
  result = {
    items: t.liveArray(Item), // Entities accumulate across pages
    nextCursor: t.optional(t.string),
  };
  loadNext = {
    searchParams: { cursor: this.result.nextCursor },
  };
}
```

After loading three pages with 2 items each, `result.items` contains all 6 items (assuming no duplicates).

### Plain arrays (`t.array`) --- replace mode

Plain arrays are **replaced** with the new page's data. The previous page's items are discarded.

```tsx
class GetItems extends RESTQuery {
  path = '/items';
  result = {
    items: t.array(t.string), // Replaced on each loadNext
    nextPage: t.optional(t.number),
  };
  loadNext = {
    searchParams: { page: this.result.nextPage },
  };
}
```

After loading a new page, `result.items` contains only the new page's items.

{% callout title="Choose the right array type" type="note" %}
Use `t.liveArray` when you want infinite scroll or "load more" behavior where items accumulate. Use `t.array` when you want traditional pagination where each page replaces the previous one (e.g. a paginated table with "Previous / Next" buttons).
{% /callout %}

---

## Scalar Field Updates

Non-array fields in the result are always **updated** to the new page's values. This is how cursor advancement works:

```tsx
result = {
  items: t.liveArray(Item),
  nextCursor: t.optional(t.string), // Updated to new cursor on each page
  totalCount: t.number, // Updated to new value on each page
};
```

After loading the next page:

- `nextCursor` is updated to the new cursor value (or `undefined`/`null` on the last page).
- `totalCount` reflects whatever the new response returned.

If the new response omits an optional field entirely, it becomes `undefined`. If it explicitly sends `null` for a nullable field, it becomes `null`.

---

## Cursor Advancement

FieldRefs automatically resolve to the **current** result data at the time `__loadNext()` is called. This means cursors advance naturally across multiple pages:

```tsx
class GetItems extends RESTQuery {
  path = '/items';
  result = {
    items: t.liveArray(Item),
    cursor: t.optional(t.string),
  };
  loadNext = {
    searchParams: { cursor: this.result.cursor },
  };
}
```

1. Initial fetch returns `{ cursor: 'c1' }`.
2. First `__loadNext()` sends `?cursor=c1`, response returns `{ cursor: 'c2' }`.
3. Second `__loadNext()` sends `?cursor=c2`, response returns `{ cursor: 'c3' }`.
4. Third `__loadNext()` sends `?cursor=c3`, response returns `{ cursor: undefined }`.
5. `__hasNext` becomes `false`. No more pages.

You do not need to manually track or update the cursor --- Fetchium handles it automatically through the FieldRef resolution mechanism.

---

## Error Handling

If a `__loadNext()` request fails (network error, server error, etc.), the promise rejects and the existing data is preserved. The array is not corrupted, and the cursor is not advanced.

```tsx
try {
  await result.__loadNext();
} catch (error) {
  // The error is from the failed fetch
  console.error('Failed to load next page:', error);
  // result.items still contains the previous pages' data
  // result.__hasNext is still true (cursor was not advanced)
}
```

This means you can safely retry by calling `__loadNext()` again after a failure --- it will use the same cursor value since the result data was not updated.

---

## Edge Cases

### Calling `__loadNext()` before initial data loads

If you call `__loadNext()` before the initial query has resolved, it throws an error:

```
Cannot call __loadNext before initial data has loaded
```

Always check `query.isReady` or `query.isPending` before accessing `__loadNext()`.

### Calling `__loadNext()` without pagination configured

If neither `loadNext` nor `getLoadNext()` is defined on the query class, calling `__loadNext()` throws:

```
loadNext is not configured
```

In this case, `__hasNext` is always `false` and `__isLoadingNext` is always `false`.

### Combining `loadNext` with `searchParams`

When `loadNext` provides additional `searchParams`, they are **merged** with the query's base search params (from the `searchParams` field or `getSearchParams()` method). The `loadNext` params take priority for any overlapping keys.

---

## Complete Example

Here is a full example showing cursor-based pagination with a live array, entity normalization, and a "load more" UI:

```tsx
import { Entity, RESTQuery, t } from 'fetchium';
import { useQuery } from 'fetchium/react';

// Entity definition
class Post extends Entity {
  __typename = t.typename('Post');
  id = t.id;
  title = t.string;
  body = t.string;
  author = t.entity(User);
  createdAt = t.format('date-time');
}

// Query with pagination
class GetPosts extends RESTQuery {
  params = { userId: t.number };
  path = '/users/[userId]/posts';
  result = {
    posts: t.liveArray(Post),
    nextCursor: t.nullish(t.string),
  };
  loadNext = {
    searchParams: {
      cursor: this.result.nextCursor,
    },
  };

  config = {
    staleTime: 30_000,
  };
}

// React component
function UserPosts({ userId }: { userId: number }) {
  const query = useQuery(GetPosts, { userId });

  if (query.isPending) return <div>Loading posts...</div>;
  if (query.isRejected) return <div>Error: {query.error.message}</div>;

  const { posts, __hasNext, __isLoadingNext, __loadNext } = query.value;

  return (
    <div>
      {posts.map((post) => (
        <article key={post.id}>
          <h2>{post.title}</h2>
          <p>{post.body}</p>
          <span>By {post.author.name}</span>
        </article>
      ))}

      {__hasNext && (
        <button onClick={() => __loadNext()} disabled={__isLoadingNext}>
          {__isLoadingNext ? 'Loading...' : 'Load More Posts'}
        </button>
      )}

      {!__hasNext && posts.length > 0 && <p>You have reached the end.</p>}
    </div>
  );
}
```

---

## Next Steps

{% quick-links %}

{% quick-link title="Live Data" icon="installation" href="/core/live-data" description="Learn how live arrays and live values keep your UI in sync" /%}

{% quick-link title="Queries" icon="presets" href="/core/queries" description="Full reference for query definitions, caching, and configuration" /%}

{% quick-link title="Type DSL Deep Dive" icon="plugins" href="/reference/type-dsl" description="Complete reference for the t type system" /%}

{% quick-link title="Entities" icon="theming" href="/core/entities" description="Normalized entity caching and identity-stable proxies" /%}

{% /quick-links %}
