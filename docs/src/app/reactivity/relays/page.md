---
title: Relays
---

A **relay** is a reactive value backed by a push-based source. Where a [reactive function](/reactivity/reactive-functions) *pulls* a value on demand, a relay *receives* values from the outside world — a timer, a WebSocket, a subscription, an event emitter — and pushes them into the reactive graph.

Relays are what let Signalium represent **asymmetric async**: one setup, many updates. Contrast that with a [reactive promise](/reactivity/reactive-promises), which is symmetric — one request in, one response out.

```ts
import { relay } from 'signalium';

const time = relay<number>((state) => {
  state.value = Date.now();
  const id = setInterval(() => (state.value = Date.now()), 1000);
  return () => clearInterval(id);
});

console.log(time.value); // most recent tick
```

A relay looks, from the outside, exactly like a reactive promise. It has the same `value`/`error`/`isPending`/`isReady` interface. The difference is internal: its value is driven by an **activation function** that sets up an external subscription and (optionally) returns a teardown.

## What problem do relays solve?

Consider a canonical React pattern: connecting to a chat room.

```tsx
function ChatRoom({ roomId }) {
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    const connection = createConnection(roomId);
    connection.onMessage((m) => setMessages((prev) => [...prev, m]));
    connection.connect();
    return () => connection.disconnect();
  }, [roomId]);

  // ...
}
```

Two things are mixed together: the **resource lifecycle** (connect / disconnect) and the **reactive value** (the message list). The dependency array couples them to the component, and anything else that wants the same data has to either repeat the effect or thread props around.

A relay pulls both halves out into a single reusable node:

```ts
import { relay, reactive, signal } from 'signalium';

const getChatConnection = reactive((roomId: string) => {
  return relay<string[]>((state) => {
    state.value = [];

    const connection = createConnection(roomId);
    connection.onMessage((m) => {
      state.value = [...(state.value ?? []), m];
    });
    connection.connect();

    return () => connection.disconnect();
  });
});
```

Now `getChatConnection(roomId)` is just another reactive value. Read it from anywhere — a component, another reactive, a [watcher](/reactivity/watchers) — and the connection will be set up the first time it becomes watched and torn down when nothing is watching it anymore.

{% callout title="Why 'relay'?" %}
The name is a reference to [electrical relays](https://en.wikipedia.org/wiki/Relay): low-power components that sit between two circuits and modulate the flow of one based on the state of the other. A Signalium relay sits between the reactive graph (well-rationalized, pull-based, pure) and the outside world (messy, push-based, full of subscriptions) and mediates between them.
{% /callout %}

## Creating a relay

```ts
import { relay } from 'signalium';

const myRelay = relay<T>((state) => {
  // Activation: set up the source, optionally seed state.value.
  // Return a teardown function, a RelayHooks object, or nothing.
});
```

The activation function receives a `state` object:

```ts
interface RelayState<T> {
  value: T | undefined;
  setPromise(promise: Promise<T>): void;
  setError(error: unknown): void;
}
```

- **`state.value = ...`** pushes a new value into the relay synchronously.
- **`state.setPromise(p)`** puts the relay back into a pending state until `p` settles. Useful for "reload" semantics.
- **`state.setError(err)`** marks the relay as rejected.

The activation function can return:

- **Nothing** — the relay has nothing to tear down.
- **A function** — called when the relay deactivates.
- **A `RelayHooks` object** — `{ update?, deactivate? }` for finer control (see [fine-grained updates](#fine-grained-updates) below).

### Example: an interval

```ts
import { relay, signal } from 'signalium';

const speed = signal(1000);

const counter = relay<number>((state) => {
  state.value = 0;

  const id = setInterval(() => {
    state.value = (state.value ?? 0) + 1;
  }, speed.value);

  return () => clearInterval(id);
});
```

Any signals read during activation become dependencies. Writing to `speed` tears down the interval and re-activates, picking up the new speed.

### Example: a WebSocket

```ts
import { relay, reactive } from 'signalium';

interface Message { id: string; text: string }

const subscribeToRoom = reactive((roomId: string) => {
  return relay<Message[]>((state) => {
    state.value = [];

    const socket = new WebSocket(`wss://chat.example.com/rooms/${roomId}`);

    socket.onmessage = (ev) => {
      const msg = JSON.parse(ev.data) as Message;
      state.value = [...(state.value ?? []), msg];
    };

    socket.onerror = (err) => state.setError(err);

    return () => socket.close();
  });
});
```

Each `roomId` gets its own relay instance (via the enclosing `reactive`). The socket opens lazily when something starts watching the relay, and closes cleanly when nothing does.

### Example: an EventTarget / EventSource

```ts
import { relay } from 'signalium';

const online = relay<boolean>((state) => {
  state.value = navigator.onLine;

  const handleOnline = () => (state.value = true);
  const handleOffline = () => (state.value = false);

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  };
});
```

This relay lives at module scope and is shared across everything that consumes it.

## Relays are reactive promises

Every relay is a `ReactivePromise<T>`. You can `await` it, read `.value`, check `.isPending`, compose it with other reactive promises — everything from the [reactive promises](/reactivity/reactive-promises) page applies.

A relay starts in a **pending** state. It transitions to **ready** the first time its `state.value` is written. Subsequent updates push new values but do not re-enter the pending state. You can force a reset by calling `state.setPromise(...)`:

```ts
import { relay } from 'signalium';

const post = relay<Post>((state) => {
  let timeoutId: ReturnType<typeof setTimeout>;

  const fetchPost = async () => {
    const res = await fetch(`/api/posts/current`);
    const data = await res.json();
    state.value = data;
    timeoutId = setTimeout(fetchPost, 10_000);
  };

  // Kick off the first fetch and mark the relay as pending until it resolves.
  state.setPromise(fetchPost());

  return () => clearTimeout(timeoutId);
});
```

Because `post` is a promise, consumers can `await post` to wait for the first value, or read `post.isPending` and `post.value` for a non-blocking read.

## Activation and deactivation

Relays are **lazy**. Creating a relay with `relay(...)` does nothing observable — no activation function runs, no external resources are acquired. The activation function runs the first time a [watcher](/reactivity/watchers) is, directly or transitively, observing the relay. When the last watcher disconnects, the relay deactivates and its teardown runs.

```ts
const logger = relay<void>((state) => {
  console.log('activated');
  return () => console.log('deactivated');
});

logger.value; // logs nothing — no watcher is observing
```

This is by design. Most relay use cases consume *resources* (timers, sockets, OS handles) that must be released when no longer needed. Tying activation to watcher presence means the lifecycle is managed automatically, no matter how dynamic the reactive graph is.

The precise rules:

- A **watcher** becomes active when at least one listener is added via `addListener`.
- A **reactive node** (reactive function or relay) becomes active when it's connected — directly or transitively — to an active watcher.
- A node stays active until it's disconnected from *all* active watchers.
- A relay's activation function runs on the transition **inactive → active**, and its teardown runs on **active → inactive**.

Because tracking is dynamic, a relay can be deactivated and re-activated multiple times as the shape of the graph changes:

```ts
const mode = signal<'a' | 'b'>('a');

const aRelay = relay<string>((state) => {
  console.log('a activated');
  state.value = 'A';
  return () => console.log('a deactivated');
});

const bRelay = relay<string>((state) => {
  console.log('b activated');
  state.value = 'B';
  return () => console.log('b deactivated');
});

const current = reactive(() => {
  return mode.value === 'a' ? aRelay.value : bRelay.value;
});

// While something watches `current`:
mode.value = 'a'; // logs "a activated"
mode.value = 'b'; // logs "a deactivated", "b activated"
mode.value = 'a'; // logs "b deactivated", "a activated"
```

This is what lets you treat relays as disposable nodes in a larger graph without manually tracking which ones you're still using.

## Fine-grained updates

By default, when a signal read during activation changes, the relay tears down and re-activates from scratch. That's correct, but sometimes expensive — opening a new WebSocket every time the room id changes, when you could just send an "unsubscribe old / subscribe new" message on the existing connection.

For that case, the activation function can return a `RelayHooks` object:

```ts
interface RelayHooks {
  update?(): void;
  deactivate?(): void;
}
```

- **`update`** is called in place of re-running activation when a tracked signal changes. Signals read *inside* `update` replace the set of tracked dependencies for the next change.
- **`deactivate`** is called when the relay's last watcher disconnects.

```ts
import { relay, signal } from 'signalium';
import { bus } from './messageBus';

const currentTopic = signal('foo');

const messageBusRelay = relay<Message>((state) => {
  const id = bus.subscribe(currentTopic.value, (msg) => (state.value = msg));

  return {
    update() {
      bus.update(id, currentTopic.value);
    },
    deactivate() {
      bus.unsubscribe(id);
    },
  };
});
```

First activation → `bus.subscribe`. Subsequent changes to `currentTopic` → `update()` is called instead of a full re-activation. When the relay goes out of use → `deactivate()` runs once.

A subtle detail: `update` tracks the signals *it* reads, not the ones the initial activation read. If you accessed something during activation but not during updates, that dependency is dropped after the first update. Track only what you need to, and keep `update` focused on applying the change.

## Relays vs. other primitives

| | Signal | Async reactive | Task | Relay |
| --- | --- | --- | --- | --- |
| Pull-based | Yes | Yes (runs on read) | No (runs on `.run()`) | No (pushes updates) |
| Re-runs on signal change | N/A | Yes | No | Yes (via `update` or re-activation) |
| Owns external resources | No | No | No | Yes |
| Multiple updates per lifecycle | No | No | No | Yes |
| Represents | State | Derived async data | Triggered action | External event stream |

If you have a pure async computation, use a [reactive promise](/reactivity/reactive-promises). If you have a triggered action, use a [task](/reactivity/reactive-promises#tasks). If you have an external source that emits updates over time and needs a lifecycle — use a relay.

## Next steps

- [Watchers](/reactivity/watchers) — how activation actually happens, and why relays need watchers to come alive.
- [Reactive promises](/reactivity/reactive-promises) — the promise interface a relay exposes.
- [`forwardRelay` and `watchOnce`](/api/signalium/utils) — helpers built on top of relays.
- [`relay` API reference](/api/signalium#relay)
