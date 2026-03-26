---
title: Live Data
---

Fetchium can keep collections and values **automatically up-to-date** as entities are created, updated, or deleted -- whether through mutations, streaming, or any other source of entity events. This is built on two primitives: **LiveArray** and **LiveValue**.

---

## Live Arrays

A LiveArray is a reactive list of entities that automatically updates when matching entities change. Instead of returning a static snapshot, the array stays in sync with the entity store.

Define a live array using `t.liveArray(EntityClass)` in your entity or query result shape:

```tsx
import { Entity, t, RESTQuery } from 'fetchium';

class Item extends Entity {
  __typename = t.typename('Item');
  id = t.id;
  name = t.string;
}

class GetItems extends RESTQuery {
  path = '/items';
  result = { items: t.liveArray(Item) };
}
```

When the query resolves, `result.items` is a reactive array. It starts with whatever the server returned, but as new `Item` entities are created (via mutations or streams), they are **automatically added** to the array. When an `Item` is deleted, it is **automatically removed**.

```tsx {% mode="react" %}
import { useQuery } from 'fetchium/react';

function ItemList() {
  const { items } = useQuery(GetItems);

  // `items` updates automatically when Items are created or deleted
  return (
    <ul>
      {items.map((item) => (
        <li key={item.id}>{item.name}</li>
      ))}
    </ul>
  );
}
```

```tsx {% mode="signalium" %}
import { fetchQuery } from 'fetchium';
import { component } from 'signalium/react';

const ItemList = component(() => {
  const { items } = fetchQuery(GetItems);

  // `items` updates automatically when Items are created or deleted
  return (
    <ul>
      {items.map((item) => (
        <li key={item.id}>{item.name}</li>
      ))}
    </ul>
  );
});
```

{% callout %}
A LiveArray without constraints (as shown above) will react to **all** entity events for the given entity type. Any newly created `Item` will be added, regardless of its field values. Use constraints to narrow which entities are included.
{% /callout %}

---

## Constraints

Constraints filter which entities get added to a live array. Only entities whose fields match the constraint values will be included.

A common pattern is to scope a live array to a parent entity. For example, a `List` entity with items that belong to it:

```tsx
class Item extends Entity {
  __typename = t.typename('Item');
  id = t.id;
  listId = t.string;
  name = t.string;
}

class List extends Entity {
  __typename = t.typename('List');
  id = t.id;
  items = t.liveArray(Item, {
    constraints: { listId: this.id },
  });
}
```

In this example, `this.id` is a **field reference** -- it resolves to the current `List` entity's `id` value at runtime. When a new `Item` is created, Fetchium checks whether its `listId` matches this list's `id`. If it does, the item is added to the array. If not, it is ignored.

This means if you have two lists (List #1 and List #2), creating an Item with `listId: '1'` will only add it to List #1's `items` array.

### Static constraint values

You can also use literal values as constraints:

```tsx
class GetActiveUsers extends RESTQuery {
  path = '/users';
  searchParams = { status: 'active' };
  result = {
    users: t.liveArray(User, {
      constraints: { status: 'active' },
    }),
  };
}
```

Only `User` entities whose `status` field is `'active'` will be added to this live array. If a mutation creates a user with `status: 'inactive'`, it will not appear here.

### Multiple entity types

You can pass an array of entity classes to `t.liveArray` to watch for multiple entity types:

```tsx
class Notification extends Entity {
  __typename = t.typename('Notification');
  id = t.id;
  message = t.string;
}

class Alert extends Entity {
  __typename = t.typename('Alert');
  id = t.id;
  message = t.string;
}

// Reacts to both Notification and Alert entity events
result = t.liveArray([Notification, Alert]);
```

{% callout type="warning" %}
When using constraints with field references like `this.id`, the field reference captures the **parent entity's** value at the time the live array is initialized. Make sure the referenced field is part of the same entity definition.
{% /callout %}

---

## Sorting

Keep live arrays sorted by providing a `sort` function. The sort function follows the same contract as `Array.prototype.sort` -- it receives two items and returns a negative number, zero, or positive number.

```tsx
class GetActiveUsers extends RESTQuery {
  path = '/users';
  result = {
    users: t.liveArray(User, {
      constraints: { status: 'active' },
      sort: (a, b) => a.name.localeCompare(b.name),
    }),
  };
}
```

When entities are added to the array (via creation events), the sort order is maintained. When entity data changes (e.g. a user's name is updated), the array is re-sorted.

---

## Live Values

A LiveValue is a single reactive value that updates in response to entity events. While LiveArrays track lists, LiveValues are useful for **computed aggregates** like counts, totals, sums, or any derived scalar.

Define a live value using `t.liveValue(valueType, EntityClass, options)`:

```tsx
class List extends Entity {
  __typename = t.typename('List');
  id = t.id;
  items = t.liveArray(Item, {
    constraints: { listId: this.id },
  });
  itemCount = t.liveValue(t.number, Item, {
    constraints: { listId: this.id },
    onCreate: (count, _item) => count + 1,
    onUpdate: (count, _item) => count,
    onDelete: (count, _item) => count - 1,
  });
}
```

The three reducer callbacks control how the value changes in response to entity events:

| Callback   | When it fires                    | Arguments                       |
| ---------- | -------------------------------- | ------------------------------- |
| `onCreate` | A new matching entity is created | `(currentValue, newEntity)`     |
| `onUpdate` | A matching entity is updated     | `(currentValue, updatedEntity)` |
| `onDelete` | A matching entity is deleted     | `(currentValue, deletedEntity)` |

Each callback receives the current accumulated value and the entity involved, and returns the new value.

### Initial value

The initial value of a live value comes from the server response. In the example above, if the server returns `{ itemCount: 3, items: [...] }`, the `itemCount` starts at `3`. Subsequent create/delete events increment or decrement from there.

### Example: tracking a total

```tsx
class Order extends Entity {
  __typename = t.typename('Order');
  id = t.id;
  customerId = t.string;
  total = t.number;
}

class Customer extends Entity {
  __typename = t.typename('Customer');
  id = t.id;
  name = t.string;
  orderTotal = t.liveValue(t.number, Order, {
    constraints: { customerId: this.id },
    onCreate: (sum, order) => sum + order.total,
    onUpdate: (sum, _order) => sum,
    onDelete: (sum, order) => sum - order.total,
  });
}
```

```tsx {% mode="react" %}
import { useQuery } from 'fetchium/react';

function CustomerSummary() {
  const { customer } = useQuery(GetCustomer, { id: '1' });

  // `orderTotal` updates automatically as orders are created/deleted
  return (
    <div>
      <h1>{customer.name}</h1>
      <p>Total spent: ${customer.orderTotal}</p>
    </div>
  );
}
```

```tsx {% mode="signalium" %}
import { fetchQuery } from 'fetchium';
import { component } from 'signalium/react';

const CustomerSummary = component(() => {
  const { customer } = fetchQuery(GetCustomer, { id: '1' });

  // `orderTotal` updates automatically as orders are created/deleted
  return (
    <div>
      <h1>{customer.name}</h1>
      <p>Total spent: ${customer.orderTotal}</p>
    </div>
  );
});
```

{% callout %}
LiveValue reducers are only triggered by **mutation events and streaming updates**, not by initial server fetches. When the server returns data, the initial value from the response is used as-is. This prevents double-counting entities that were already included in the server response.
{% /callout %}

---

## How Live Data Works

Under the hood, live data is powered by Fetchium's entity event system:

1. **Event sources.** When a mutation completes or a stream delivers an update, Fetchium fires an entity event (`create`, `update`, or `delete`) with the typename and entity data.

2. **Binding registration.** Each `t.liveArray` or `t.liveValue` field creates a `LiveCollectionBinding` that registers itself with the `QueryClient`. The binding declares which entity typenames it watches and what constraints must be satisfied.

3. **Constraint matching.** When an entity event fires, Fetchium checks all registered bindings for that typename. For each binding, it computes a constraint hash from the entity's data and compares it against the binding's expected hash. Only matching bindings receive the event.

4. **Reactive notification.** When a binding processes an event (adding/removing from a LiveArray, or running a reducer for a LiveValue), it fires a reactive notification. Any component or reactive function reading from that live field will re-render or re-evaluate.

This design means live data is **fully local** -- it does not require any special server protocol. Any operation that produces an entity event (mutations, streaming, or even `applyMutationEvent` called manually) will trigger live collection updates.

---

## Pagination & Infinite Queries

Fetchium supports cursor-based and offset-based pagination via the `loadNext` configuration on queries. Live arrays work seamlessly with pagination -- when you load additional pages, new entities are **appended** to the existing live array rather than replacing it.

```tsx
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

After fetching, call `__loadNext()` on the query result to load the next page:

```tsx {% mode="react" %}
import { useQuery } from 'fetchium/react';

function ItemList() {
  const result = useQuery(GetItems);

  if (!result.isReady) return <div>Loading...</div>;

  return (
    <div>
      <ul>
        {result.value.items.map((item) => (
          <li key={item.id}>{item.name}</li>
        ))}
      </ul>
      {result.__hasNext && (
        <button onClick={() => result.__loadNext()}>Load more</button>
      )}
    </div>
  );
}
```

```tsx {% mode="signalium" %}
import { fetchQuery } from 'fetchium';
import { component } from 'signalium/react';

const ItemList = component(() => {
  const result = fetchQuery(GetItems);

  if (!result.isReady) return <div>Loading...</div>;

  return (
    <div>
      <ul>
        {result.value.items.map((item) => (
          <li key={item.id}>{item.name}</li>
        ))}
      </ul>
      {result.__hasNext && (
        <button onClick={() => result.__loadNext()}>Load more</button>
      )}
    </div>
  );
});
```

The `loadNext.searchParams` object uses **field references** (`this.result.nextCursor`) to automatically pull pagination cursors from the previous response. Each call to `__loadNext()` fetches the next page and appends entities to the live array.

{% callout %}
For non-live arrays (`t.array` instead of `t.liveArray`), `__loadNext()` **replaces** the array contents with the new page. Only `t.liveArray` accumulates across pages.
{% /callout %}

For full details on pagination patterns, including offset-based pagination and conditional loading, see the [Pagination reference](/reference/pagination).

---

## Streaming Updates

Entities can subscribe to real-time updates by defining a `__subscribe` method on the entity class. When an entity with `__subscribe` is actively observed (read by a component or reactive function), Fetchium establishes the subscription and routes incoming events through the live data system.

```tsx
class ChatMessage extends Entity {
  __typename = t.typename('ChatMessage');
  id = t.id;
  channelId = t.string;
  text = t.string;
  author = t.entity(User);

  __subscribe(onEvent) {
    const es = new EventSource(`/api/messages/${this.id}/stream`);
    es.onmessage = (e) => {
      onEvent(JSON.parse(e.data));
    };
    return () => es.close();
  }
}
```

When the stream delivers a `create` event for a `ChatMessage`, any live array watching `ChatMessage` entities will automatically include it. When it delivers a `delete` event, the message is removed.

This makes it straightforward to build real-time features: define your entities with `__subscribe`, use `t.liveArray` or `t.liveValue` in your result shapes, and the UI updates automatically.

For full details on streaming patterns and transport options, see the [Streaming reference](/reference/streaming).
