---
title: Relays and Watchers
nextjs:
  metadata:
    title: Relays and Watchers
    description: Understanding Relays and Watchers in Signalium
---

We covered how Signalium handles promise-based async operations in the last section, and that covers most _symmetric_ forms of async; That is, forms of async where there is exactly one request/invocation and one response/result. But, what about _asymmetric async_?

Asymmetric async refers to any operation where you may send _one or more requests_ and receive _one or more responses_. Some common examples include:

- Subscribing to a topic on a message bus
- Sending messages back and forth between separate threads
- Adding a listener to an external library, like TanStack Query
- Setting up a regular polling job or other interval based task

**Relays** are a type of Reactive Promise that specifically handles these sorts of operations. When combined with **Watchers**, they allow you to set up and manage the full lifecycle of long-lived effects and resources, including dynamically cleaning up resources when they are no longer needed, and rebooting them whenever they are needed again.

---

## What are Relays?

The core idea for Relays comes from the idea that in some cases, we need to _send state_ out of the reactivity graph in the form of a side-effect (e.g. connecting to the current server URL) and then _receive updates_ from that side-effect back into the graph (e.g. messages being sent to our subscription). And importantly, we want to _update this side-effect over time_ as our state changes.

Managed side-effects are a very common pattern in modern web applications. In fact, the [canonical example](https://react.dev/reference/react/useEffect) for React's `useEffect` Hook is exactly this pattern.

```js
import { useState, useEffect } from 'react';
import { createConnection } from './chat.js';

function ChatRoom({ roomId }) {
  const [serverUrl, setServerUrl] = useState('https://localhost:1234');

  useEffect(() => {
    const connection = createConnection(serverUrl, roomId);
    connection.connect();
    return () => {
      connection.disconnect();
    };
  }, [serverUrl, roomId]);
  // ...
}
```

There are two notable things about this example:

1. `serverUrl` is _dynamic_ - it can update over time, and we need to update our connection to use the new URL whenever it changes.
2. This `useEffect` example _connects_ to the server, and presumably that connection is doing _something_ to receive messages from the server. But, we don't really know what that is without looking at the implementation of `createConnection`. This is a form of [spooky action at a distance](<https://en.wikipedia.org/wiki/Action_at_a_distance_(computer_programming)>), and its something we generally want to avoid.

Relays formalize a pattern for handling this sort of side-effect by combining a managed-effect with a slot for state that is _only_ accessible internally. This allows us to expose the latest updates from our connection to the rest of the graph, while keeping the implementation details of the connection hidden.

```js
import { relay, reactive, signal } from 'signalium';
import { createConnection } from './chat.js';

const serverUrl = signal('https://localhost:1234');

const getChatConnection = reactive(({ roomId }) => {
  return relay<string[]>((state) => {
    // initial empty message list
    state.value = [];

    const connection = createConnection(serverUrl.value, roomId);

    connection.onMessage((message) => {
      state.value = [...state.value, message];
    });

    connection.connect();

    return () => {
      connection.disconnect();
    };
  });
});
```

From the perspective of the rest of the reactive graph, the Relay node is just like any other reactive value, and signal-purity is maintained. For all anyone can tell, the Relay is just another Signal or Reactive Function, and a user is just actively pressing a button to add messages to the list. Internally, the Relay can do whatever it wants to keep track of the messages, and decide if and when it needs to send updates back to the graph. In this way, Relays are a form of intermediary between the reactive graph and the external world.

{% callout title="Why 'Relay'?" %}
The term "Relay" is a reference to [real-life signal relays](https://en.wikipedia.org/wiki/Relay), which are devices used to control circuits via low powered electrical signals. While this is a bit of a tongue-in-cheek reference, it is still a very apt metaphor for the purpose of Relays - they are nodes that act as repeaters and transformers of state, modulating between the well-rationalized world of the reactive graph and the wild, unruly world of external resources and unmanaged side-effects.
{% /callout %}

### Creating Relays

Relays are created much like Reactive Tasks, as individual instances rather than functions. They define an activation function that runs when they become watched (detailed below), and that function receives the state of the Relay as the first parameter.

```js {% visualize=true %}
import { relay, reactive, signal } from 'signalium';

const speed = signal(5);

const counter = relay((state) => {
  state.value = 0;

  const id = setInterval(() => state.value++, speed.value * 1000);

  return () => clearInterval(id);
});

export const counterWrapper = reactive(() => {
  return counter.value;
});
```

The activation function should set up a side-effect and (optionally) return a destructor. Like with Reactive Functions, any reactive state that is used during the activation function will become a dependency of the Relay, and if that state updates, the destructor function will be called and the Relay will be recreated.

### Relays as Reactive Promises

As mentioned above, Relays are really a type of Reactive Promise, but promises are modeled for _symmetric_ async - one request sent, one response received. So, why do Relays act like Reactive Promises, and how do they handle asymmetric async differently?

The primary reason is that Relays are also promises is that they often have an _initialization_ step while they wait for the first event they want to receive. For instance, let's say you want to load a `Post` model and poll for real time updates for it as long as we're on that page. When we first load the page, we don't have any data, so we want to show a loading spinner. After the first message is received, we can show the cached data and continue polling in the background.

```ts
const getPostData = reactive((id) => {
  return relay((state) => {
    let currentTimeout;

    const fetchPost = async () => {
      const res = await fetch(`https://examples.com/api/posts/${id}`);
      const { post } = await res.json();

      state.value = post;

      // schedule the next fetch in 10s
      currentTimeout = setTimeout(fetchPost, 10000);
    };

    // initialize
    fetchPost();

    return () => clearTimeout(currentTimeout);
  });
});

export const getPostTitle = reactive(async (id) => {
  // Relay can be awaited just like a standard promise
  const data = await getPostData(id);

  return data.title;
});
```

Relays "resolve" the first time their state is set. Every time after that, everything that consumes the Relay will be notified of changes and updates, but they will resolve immediately without needing to wait for async or triggering the `isPending` state.

If you need to reset the loading state for any reason, e.g. if you navigate back to a page that was already active and you want to refetch the value eagerly, you can set the value to a _new_ promise with `state.setPromise`, and the promise state will be reflected on the Relay until it completes.

```ts
const getPostData = reactive((id) => {
  return relay((state) => {
    let currentTimeout;

    const fetchPost = async () => {
      const res = await fetch(`https://examples.com/api/posts/${id}`);
      const { post } = await res.json();

      state.value = post;

      // schedule the next fetch in 10s
      currentTimeout = setTimeout(fetchPost, 10000);
    };

    // Setting the value to initial promise will cause the Relay to go
    // back into a pending state, causing everything else to wait for it.
    state.setPromise(fetchPost());

    return () => clearTimeout(currentTimeout);
  });
});
```

### Fine-grained updates

Relay constructors can also return an object with the following signature:

```ts
interface RelayHooks {
  update?(): void;
  deactivate?(): void;
}
```

This form of Relay is for cases where you may want more fine-grained control over how the Relay is updated. For instance, it might be fairly expensive to teardown a Relay and recreate it each time, and there might be a cheaper way to update it.

```js
import { relay, signal } from 'signalium';
import { bus } from './messageBus.js';

const currentTopic = signal('foo');

const messageBusRelay = relay((state) => {
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

One thing to note about this form is that it tracks the initial activation function, then tracks the `update` function on each update. Tracking is based on the _last update_ only, so if you access something during activation but _not_ during updates, it will not be consumed again.

This covers the ways that Relays can update _reactively_ when in use. However, we also need to set up Relays when they are first accessed, and tear them down when they're no longer needed. For that, we need to introduce _Watchers_.

## Watchers

**Watchers** are the ultimate exit points for the reactive graph. When a Watcher reads a Signal or Reactive Function, it consumes them just like any other Reactive Function. However, when those values update, the Watcher will be notified and will trigger any listeners added via `addListener`.

```js
const count = signal(0);

const plusOne = reactive(() => {
  return count.value + 1;
});

const w = watcher(() => {
  return plusOne();
});

const removeListener = w.addListener(() => {
  console.log(w.value);
});

// logs 1 after timeout and initial run

count.value = 5; // logs 6 after timeout

// later...
removeListener();

count.value = 10; // no longer logs
```

Watchers are essentially actively _pulling_ on the graph at all times. As long as they are live and have listeners, any updates to Signals in the graph will be automatically pulled and propagated toward the Watcher.

Watchers are _typically_ handled by the framework integration that you are using. For instance, `signalium/react` provides the `component` helper, which sets up a Watcher for your component and notifies React when that component needs to re-render.

```jsx
import { signal, reactive } from 'signalium';
import { component } from 'signalium/react';

const count = signal(0);

const plusOne = reactive(() => {
  return count.value + 1;
});

const plusTwo = reactive(() => {
  // plusOne() is called inside another Reactive Function,
  // does not set up a Watcher
  return plusOne() + 1;
});

export const Component = component(() => {
  // plusTwo() is called inside a React component,
  // sets up a Watcher and synchronizes it with React
  // state so it re-renders whenever the Watcher updates.
  const valuePlusTwo = plusTwo();

  return <div>{valuePlusTwo}</div>;
});
```

In general, you shouldn't need to worry about managing Watchers yourself because of this, but they are very important _conceptually_ to Relays, which is why they are included in the Core Concepts section.

{% callout type="warning" title="Note" %}
Watchers should never be created or managed _inside_ Reactive Functions or Relays. They are meant to be _terminal nodes_ that pull on the graph of dependencies and make it "live". Relays generally work like "internal Watchers" (i.e. they will also update automatically while they're live via an external Watcher), so there should never be a reason to create a Watcher in the graph itself. Use a Relay instead.
{% /callout %}

### Watcher scheduling

Watchers have to run at some point, but for performance and consistency they do _not_ run immediately after a change. Instead, they get scheduled to run later at some point. _When_ exactly is globally configurable, but defaults to the next macro task (e.g. `setTimeout(flush, 0)`).

Scheduled Watchers essentially act like if you manually ran a Reactive Function, only later. You can imagine it as something like this:

```js
const myFn = reactive(() => {
  // ...
}):

function handleClickEvent() {
  // change some state

  setTimeout(() => myFn(), 0);
}
```

When we flush Watchers, we do them together in the same browser task in a way that minimizes the number of scheduled tasks and any thrashing that might occur. They are automatically scheduled if they have any listeners, and if any value in their dependency tree has changed.

That said, the call order for Watchers is still from _changed state_ outward, toward the Watcher. This means that the Watcher will only rerun if any of its direct dependencies have _also_ changed, following the same rules discussed in the [Reactive Functions section](/core/signals-and-reactive-functions). In addition, listeners added with `addListener` will not run if the value returned from the Watcher itself has not updated.

### Timing, caching, and immediacy

On occasion, you might want to write to a Signal and then immediately read from a Reactive Function that consumed that signal. As noted in the previous section on Signals and Reactive Functions, this is perfectly valid and will work as expected.

```js
const state = signal(0);

const getDerived = reactive(() => {
  return state.value + 1;
});

function updateValue(value) {
  state.value = value;

  getDerived(); // value + 1
}
```

Watcher scheduling does not affect this behavior. Scheduled Watchers _do_ pull automatically at some point, and if nothing else reads a watched Reactive Function, it _will_ run when the Watcher flushes. BUT, if the value is read earlier, it will run on-demand and cache the result, which will then be read by the Watcher when it flushes. In effect, Watchers act as a guarantee that any and all watched Reactive Functions will rerun automatically _eventually_, but if you need to speed that process up, you can at any time.

## Active Watchers and Relays

By default, without introducing Watchers, Relays are _inert_. If you access a Relay on its own, it will not activate and start updating - it will just return its current value.

```js
import { relay } from 'signalium';

const logger = relay(() => {
  console.log('subscribed');

  return () => console.log('unsubscribed');
});

logger(); // logs nothing
```

This value will still be tracked by any Reactive Functions that use it, but the Relay itself will never do anything. The reason for this comes down to _resource management_ - that is to say, we want to only consume system resources when we need them, and we want to free them up when they're no longer needed.

With standard and even async values, this is not really an issue because they _mostly_ use memory, and that will _mostly_ naturally be cleaned up by garbage collection (ignoring promise lifecycle, abort signals, etc. for simplicity here). Most use-cases for Relays, however, necessarily consume resources until they are _torn down_. Background threads, WebSockets, polling — these are all things that need some external event that says they are no longer needed.

Watchers conceptually represent the parts of the app that are _active_: They are "in use", and should be updating or running background tasks and so on. These are the exit points where your Signals are writing to _something_ external, and that something is what is driving the lifecycle of your Signal graph.

This leads us to _active status_. Active status is defined as follows:

- **Watchers** become **_active_** when 1 or more event listeners are added to them.
- **Nodes** (Reactive Functions or Relays) become **_active_** when they are connected directly OR indirectly to an active Watcher.
- **Nodes** remain active until they are disconnected from _all_ active consumers, at which point they become **_inactive_**.
- **Watchers** remain active until all listeners are removed.

Essentially, if you're directly or indirectly connected to an active Watcher, you are active, and if not, then you're inactive.

And last but not least: a Relay's _lifecycle_ is tied directly to whether or not it's _active_. They run their setup upon activating, and run their deactivate function upon deactivating.

{% callout title="Additional Info" %}
This whole setup might seem a bit convoluted — why do we need to do this dance with Watchers and Relays? Why not just expose a `deactivate` method on Relays and call that when they're no longer needed?

The main reason is that the shape of the reactive graph is _dynamic_, since we can [use values conditionally](/core/signals-and-reactive-functions#conditional-usage). So you might connect to a WebSocket initially in some Reactive Function, but then disconnect on the next update.

This dynamism makes manual Relay management intractably hard. You would need to maintain references to all previous Reactive Functions that had Relays, track whether or not they were reused, and call their destructors if not, all manually. This would be a pervasive pattern and would quickly add mountains of complexity to your codebase.

For all these reasons, Relay management and active status is considered a _core part_ of Reactive Function lifecycle in Signalium. You can't have Relays without active status, and you can't define active status without some sort of external _sink_ to pull on the graph. That sink is a Watcher.
{% /callout %}

## Summary

With all of that in mind, let's summarize what we've learned:

- Relays
  - Manage side-effects in a single, self-contained node with its own state
  - Implementation details are hidden, externally it works just like any other Reactive Promise
  - Primarily used for _asymmetric async_ (think UDP vs TCP)
  - Activate when _connected_ to an active Watcher, and deactivate when _disconnected_ from all active Watchers
- Watchers
  - Represent the active parts of the app
  - How state gets read from Signalium to external consumers
  - Schedules and "pulls" asynchronously
  - Activates when listener added with `addListener`

Now we just have one last core feature left: Contexts.
