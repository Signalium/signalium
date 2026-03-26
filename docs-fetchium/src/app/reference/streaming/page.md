---
title: Streaming & Subscriptions
---

Fetchium supports real-time updates through entity subscriptions and streaming queries. Data can be pushed to clients via WebSocket, Server-Sent Events (SSE), polling, or any custom transport. Because streaming integrates directly with Fetchium's entity event system, incoming data flows through the same normalization and live data pipelines as mutations --- live arrays update, live values recompute, and components re-render automatically.

---

## Entity Subscriptions

Entities can opt into real-time updates by defining a `__subscribe` method. When an entity with `__subscribe` is actively observed --- read by a mounted component or watched by a reactive function --- Fetchium calls `__subscribe` to establish the connection. When all observers disconnect, the cleanup function is called to tear down the connection.

```tsx
import { Entity, t } from 'fetchium';

class Message extends Entity {
  __typename = t.typename('Message');
  id = t.id;
  text = t.string;
  channelId = t.number;

  __subscribe(onEvent: (event: MutationEvent) => void) {
    const ws = new WebSocket(`ws://api.example.com/messages/${this.id}`);

    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);
      onEvent({ type: 'update', typename: 'Message', data });
    };

    return () => ws.close(); // cleanup
  }
}
```

The `onEvent` callback accepts a `MutationEvent` and routes it through Fetchium's entity event system. This means any live arrays or live values watching `Message` entities will react to the event automatically.

{% callout title="Subscription lifecycle" %}
Subscriptions are **demand-driven**. Fetchium only calls `__subscribe` when at least one component or reactive function is reading the entity. When the last observer disconnects (e.g., a component unmounts), the cleanup function returned by `__subscribe` is called immediately. This prevents resource leaks from orphaned WebSocket connections or event listeners.
{% /callout %}

---

## Mutation Events

All streaming data flows through the same `MutationEvent` type used by mutations. There are three event types:

### Create

Signals that a new entity was created. The `data` object must include the entity's `id` field.

```tsx
{
  type: 'create',
  typename: 'Message',
  data: { id: '42', text: 'Hello!', channelId: 1 }
}
```

When a `create` event fires, any live array watching the given typename (and whose constraints match the entity's data) will automatically add the new entity.

### Update

Signals that an existing entity's data changed. Fetchium merges the incoming data with the entity's current cached state.

```tsx
{
  type: 'update',
  typename: 'Message',
  data: { id: '42', text: 'Hello! (edited)' }
}
```

Partial updates are supported --- you only need to include the fields that changed, plus the `id`. Any component reading the updated fields will re-render; components reading only unchanged fields will not.

### Delete

Signals that an entity was removed. The `data` field is the entity's ID (string or number).

```tsx
{
  type: 'delete',
  typename: 'Message',
  data: '42'
}
```

When a `delete` event fires, the entity is removed from any live arrays that contain it, and live values with `onDelete` reducers are updated.

---

## Streaming with Live Collections

The real power of streaming comes from combining entity subscriptions with live data primitives. Define your result shapes using `t.liveArray` or `t.liveValue`, add a `__subscribe` method to your entity, and the UI stays in sync automatically.

### Real-time chat example

```tsx
class ChatMessage extends Entity {
  __typename = t.typename('ChatMessage');
  id = t.id;
  text = t.string;
  channelId = t.string;
  author = t.entity(User);
  createdAt = t.string;

  __subscribe(onEvent: (event: MutationEvent) => void) {
    const es = new EventSource(`/api/messages/${this.id}/stream`);

    es.onmessage = (e) => {
      onEvent(JSON.parse(e.data));
    };

    return () => es.close();
  }
}

class GetMessages extends RESTQuery {
  params = { channelId: t.string };
  path = '/channels/[channelId]/messages';
  result = {
    messages: t.liveArray(ChatMessage, {
      constraints: { channelId: this.params.channelId },
      sort: (a, b) => a.createdAt.localeCompare(b.createdAt),
    }),
  };
}
```

When the subscription fires a `create` event for a `ChatMessage` whose `channelId` matches the query's param, the message is automatically inserted into the live array in sorted order. When it fires a `delete` event, the message is removed. Components reading `messages` re-render with the updated list.

```tsx
import { component } from 'signalium/react';
import { useQuery } from 'fetchium/react';

const ChatRoom = component(({ channelId }: { channelId: string }) => {
  const { messages } = useQuery(GetMessages, { channelId });

  return (
    <div>
      {messages.map((msg) => (
        <div key={msg.id}>
          <strong>{msg.author.name}</strong>: {msg.text}
        </div>
      ))}
    </div>
  );
});
```

No additional wiring is needed. The subscription activates when the component mounts and deactivates when it unmounts.

### Live values with streaming

Live values also respond to streaming events. For example, tracking an unread count:

```tsx
class Channel extends Entity {
  __typename = t.typename('Channel');
  id = t.id;
  name = t.string;
  unreadCount = t.liveValue(t.number, ChatMessage, {
    constraints: { channelId: this.id },
    onCreate: (count, _msg) => count + 1,
    onUpdate: (count, _msg) => count,
    onDelete: (count, _msg) => count - 1,
  });
}
```

When a new `ChatMessage` arrives via the stream for this channel, `unreadCount` increments. When a message is deleted, it decrements. The component reading `channel.unreadCount` re-renders with the new value.

---

## Channel-Level Subscriptions

In many applications, you want to subscribe to events for an entire collection rather than individual entities. You can implement this by defining `__subscribe` on a parent entity or by using a query-level subscription pattern:

```tsx
class Channel extends Entity {
  __typename = t.typename('Channel');
  id = t.id;
  name = t.string;

  __subscribe(onEvent: (event: MutationEvent) => void) {
    const ws = new WebSocket(`ws://api.example.com/channels/${this.id}/events`);

    ws.onmessage = (e) => {
      // The server sends events for all entity types in this channel
      const event = JSON.parse(e.data);
      onEvent(event);
    };

    return () => ws.close();
  }
}
```

The server can send events for any entity type through a single connection. For example, it might push `ChatMessage` create events, `User` update events (online/offline status), and `Reaction` events all through the same WebSocket. Each event is routed to the appropriate live collections based on its `typename`.

---

## Polling

For simpler real-time needs --- or when WebSocket infrastructure is not available --- Fetchium supports polling as a subscription mechanism. Polling periodically re-fetches query data and applies entity updates through the same event pipeline.

### Configuring polling on a query

```tsx
class GetNotifications extends RESTQuery {
  path = '/notifications';
  result = {
    notifications: t.liveArray(Notification),
  };
  polling = {
    interval: 5000, // poll every 5 seconds
  };
}
```

When a component is reading from this query, Fetchium re-fetches the endpoint at the configured interval. The response is diffed against the entity cache, and any changes are emitted as entity events --- which in turn update live arrays and live values.

{% callout %}
Polling follows the same demand-driven lifecycle as subscriptions. Fetchium only polls while at least one component or reactive function is reading from the query. When all observers disconnect, polling stops.
{% /callout %}

### Polling vs. subscriptions

|                         | Polling                              | Subscriptions (`__subscribe`)               |
| ----------------------- | ------------------------------------ | ------------------------------------------- |
| **Transport**           | HTTP (re-fetches the same endpoint)  | Any (WebSocket, SSE, custom)                |
| **Latency**             | Bounded by interval                  | Near real-time                              |
| **Server requirements** | None (standard REST endpoint)        | Server must push events                     |
| **Best for**            | Low-frequency updates, simple setups | High-frequency updates, chat, collaboration |

Both mechanisms feed into the same entity event system, so you can mix and match. Use polling for some queries and subscriptions for others --- the live data layer does not care where events originate.

---

## Custom Transports

You can implement any transport mechanism to deliver real-time updates. The key integration point is `queryClient.applyMutationEvent()`, which injects a `MutationEvent` into the entity event system manually.

### Example: shared WebSocket connection

```tsx
import { QueryClient } from 'fetchium';

const queryClient = new QueryClient();

// Single WebSocket for all real-time events
const ws = new WebSocket('ws://api.example.com/events');

ws.onmessage = (e) => {
  const event = JSON.parse(e.data);

  // Route the event through Fetchium's entity system
  queryClient.applyMutationEvent(event);
};
```

This is useful when your application has a single event bus (e.g., one WebSocket connection for the entire app) rather than per-entity subscriptions. Events pushed through `applyMutationEvent` behave identically to events from `__subscribe` or mutations --- they trigger live array updates, live value reducers, and component re-renders.

### Example: Server-Sent Events

```tsx
const eventSource = new EventSource('/api/events');

eventSource.addEventListener('entity-event', (e) => {
  const event = JSON.parse(e.data);
  queryClient.applyMutationEvent(event);
});
```

### Example: Firebase Realtime Database

```tsx
import { ref, onValue } from 'firebase/database';

const messagesRef = ref(db, `channels/${channelId}/messages`);

onValue(messagesRef, (snapshot) => {
  const messages = snapshot.val();

  Object.entries(messages).forEach(([id, data]) => {
    queryClient.applyMutationEvent({
      type: 'update',
      typename: 'ChatMessage',
      data: { id, ...data },
    });
  });
});
```

{% callout type="warning" %}
When using `applyMutationEvent` directly, you are responsible for managing the connection lifecycle (opening, reconnecting, closing). Fetchium does not manage custom transport connections --- it only processes the events you deliver.
{% /callout %}

---

## Subscription Lifecycle

Understanding when subscriptions activate and deactivate is important for managing resources and avoiding leaks.

### Activation

A subscription activates when:

1. A component mounts and reads an entity that defines `__subscribe`.
2. A reactive function watched by a watcher reads the entity.
3. A live array or live value that depends on the entity is being observed.

Fetchium calls `__subscribe` once per entity instance, regardless of how many observers are reading it.

### Deactivation

A subscription deactivates when:

1. All components reading the entity unmount.
2. All watchers observing the entity disconnect.
3. The entity is evicted from the cache.

At that point, Fetchium calls the cleanup function returned by `__subscribe`.

### Reconnection

If an entity is unobserved and then observed again (e.g., a component remounts), `__subscribe` is called again to re-establish the connection. Fetchium does not cache or reuse previous subscriptions.

{% callout title="Memory management" %}
Always return a cleanup function from `__subscribe`. If you open a WebSocket, EventSource, or any other persistent connection, the cleanup function must close it. Failing to do so will leak connections even after the entity is no longer observed.
{% /callout %}

---

## Combining Patterns

In practice, most applications combine multiple real-time strategies:

```tsx
// Entity-level subscription for individual message updates
class ChatMessage extends Entity {
  __typename = t.typename('ChatMessage');
  id = t.id;
  text = t.string;
  channelId = t.string;

  __subscribe(onEvent) {
    // Per-message updates (edits, reactions)
    const es = new EventSource(`/api/messages/${this.id}/stream`);
    es.onmessage = (e) => onEvent(JSON.parse(e.data));
    return () => es.close();
  }
}

// Channel-level subscription for new messages in a channel
class Channel extends Entity {
  __typename = t.typename('Channel');
  id = t.id;

  __subscribe(onEvent) {
    // New message events for the entire channel
    const ws = new WebSocket(`ws://api.example.com/channels/${this.id}`);
    ws.onmessage = (e) => onEvent(JSON.parse(e.data));
    return () => ws.close();
  }
}

// Polling for low-priority data
class GetSystemStatus extends RESTQuery {
  path = '/status';
  result = t.object({ healthy: t.boolean, activeUsers: t.number });
  polling = { interval: 30000 };
}
```

All three patterns --- entity subscriptions, channel-level subscriptions, and polling --- feed into the same entity event system. Live arrays and live values respond to events regardless of their origin, giving you a unified reactive data layer.
