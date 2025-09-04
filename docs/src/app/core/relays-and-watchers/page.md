---
title: Relays and Watchers
nextjs:
  metadata:
    title: Relays and Watchers
    description: Understanding relays and watchers in Signalium
---

We covered how Signalium handles symmetric (call-response) style operations in the last section, but what about _asymmetric async_?

And before we answer that, what even _is_ asymmetric async?

Asymmetric async refers to any async operation where you may send _one or more requests_ and receive _one or more responses_. Some common examples include:

- Subscribing to a topic on a message bus
- Sending messages back and forth between separate threads
- Adding a listener to an external library, like Tanstack Query
- Setting up a regular polling job or other interval based task

**Relays** are a type of reactive promise that specifically handles these sorts of operations. When combined with **Watchers**, they allow you to setup and manage the full lifecycle of long-live effects and resources.

---

## What are Relays?

The core idea for relays comes from the observation that it is a very common pattern to use a _managed effect_ paired with some _state_ that is only accessible internally. For example, in React you might have something like this:

```js
const useCounter = (ms) => {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setCount((count) => count + 1);
    }, ms);

    return () => clearInterval(id);
  }, [ms]);

  return count;
};
```

To callers of `useCounter`, the management of the interval and the associated state is a completely opaque process. They just get the latest count, and they rerun when the count updates.

This is notable because it preserves functional purity for everything _outside_ of `useCounter`. While `useCounter` is managing and mutating state regularly, any hook calling it is just getting the latest value and using it to derive the result. It could be a static value _or_ a dynamic one, and the code would be the same.

Relays formalize this pattern by combining a managed-effect with a slot for state that _by design_ is only accessible internally. From the perspective of the rest of the dependency graph, the relay node is just like any other reactive value or state, and functional purity is maintained.

### Creating relays

Relays are created much like tasks, as individual instances rather than functions:

```js {% visualize=true %}
import { relay, reactive, signal } from 'signalium';

const speed = signal(5);

const counter = relay(
  (state) => {
    const id = setInterval(() => state.value++, speed.value * 1000);

    return () => clearInterval(id);
  },
  { initValue: 0 },
);

export const counterWrapper = reactive(() => {
  return counter.value;
});
```

Relays define a constructor function that runs when they become watched (detailed below). The function receives a signal as the first parameter, and should setup a side-effect and (optionally) return a destructor. Like with reactive functions, any reactive state that is used during this constructor will become a dependency of the relay, and if that state updates, the destructor function will be called and the relay will be recreated.

### Relays as promises

As mentioned above, relays are really a type of reactive promise, but promises are modeled for _symmetric_ async - one request sent, one response received. So, why do relays act like promises, and how do they handle asymmetric async differently?

The primary reason is that relays are promise-like is that they often have an _initialization_ step while they wait for the first event they want to receive. For instance, let's say you want to load a `Post` model and poll for real time updates for it as long as we're on that page. When we first load the page, we don't have any data, so we want to show a loading spinner. After the first message is received, we can show the cached data and continue polling in the background.

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
  // relay can be awaited just like a standard promise
  const data = await getPostData(id);

  return data.title;
});
```

Relays "resolve" the first time their state is set. If you pass an initial value via the `initValue` option, they will initialize resolved. Every time after that, everything that consumes the relay will be notified of changes and updates, but they will resolve immediately without needing to wait for async or triggering the `isPending` state.

If you need to reset the loading state for any reason, e.g. if you navigate back to a page that was already active and you want to refetch the value eagerly, you can set the value to a _new_ promise with `state.setPromise`, and the promise state will be reflected on the relay until it completes.

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

    // Setting the value to initial promise will cause the relay to go
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

This form of relay is for cases where you may want more fine-grained control over how the relay is updated. For instance, it might be fairly expensive to teardown a relay and recreate it each time, and there might be a cheaper way to update it.

```js
const currentTopic = signal('foo');

const messageBus = relay((state) => {
  const id = bus.subscribe(currentTopic.value, (msg) => (state.value = msg));

  return {
    update() {
      bus.update(id, currentTopic.value);
    },

    unsubscribe() {
      bus.unsubscribe(id);
    },
  };
});
```

One thing to note about this form is that it tracks the initial construction function, then tracks the `update` function on each update. Tracking is based on the _last update_ only, so if you access something in subscribe but not in updates, it will not trigger again.

This covers the ways that relays can update _reactively_ when in use. However, we also need to setup relays when they are first accessed, and tear them down when they're no longer needed. For that, we need to introduce _watchers_.

## Watchers

With **watchers**, you listen to updates from signals _externally_. This is how signals are ultimately consumed by your framework of choice, and by your larger application.

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

Watchers are _typically_ handled by the framework integration that you are using. For instance, `signalium/react` provides the `component` helper, which sets up a watcher for your component and notifies React when that component needs to re-render.

```jsx
import { signal, reactive } from 'signalium';
import { component } from 'signalium/react';

const count = signal(0);

const plusOne = reactive(() => {
  return count.value + 1;
});

const plusTwo = reactive(() => {
  // plusOne() is called inside another reactive function,
  // does not setup a watcher
  return plusOne() + 1;
});

export const Component = component(() => {
  // plusTwo() is called inside a React component,
  // sets up a watcher and synchronizes it with React
  // state so it rerenders whenever the watcher updates.
  const valuePlusTwo = plusTwo();

  return <div>{valuePlusTwo}</div>;
});
```

In general, you shouldn't need to worry about managing watchers yourself because of this, but they are very important _conceptually_ which is why they are included in the core concepts.

{% callout type="warning" title="Note" %}
Watchers should never be created or managed _inside_ reactive functions or relays. They are meant to be _terminal nodes_ that pull on the graph of dependencies and make it "live". Relays generally work like "internal watchers" (i.e. they will also update automatically while they're live via an external watcher), so there should never be a reason to create a watcher inside of one.
{% /callout %}

### Watcher scheduling

Watchers have to run at some point, but for performance and consistency they do _not_ run immediately after a change. Instead, they get scheduled to run later at some point. _When_ exactly is globally configurable, but defaults to the next macro task (e.g. `setTimeout(flush, 0)`).

Scheduled watchers essentially act like if you manually ran a reactive function, only later. You can imagine it as something like this:

```js
const myFn = reactive(() => {
  // ...
}):

function handleClickEvent() {
  // change some state

  setTimeout(() => myFn(), 0);
}
```

When we flush watchers, we do them together in the same task in a way that minimizes the number of scheduled tasks and any thrashing that might occur. They are automatically scheduled if they have any listeners, and if any value in their dependency tree has changed.

That said, the call order for watchers is still from _changed state_ outward, toward the watcher. This means that the watcher will only rerun if any of its direct dependencies have _also_ changed, following the same rules discussed in the [reactive functions section](/core/signals-and-reactive-functions). In addition, listeners added with `addListener` will not run if the value returned from the watcher itself has not updated.

### Timing, caching, and immediacy

On occasion, you might want to write to a state signal and then immediately read from a reactive function that consumed that signal. As noted in the previous section on reactive functions and state, this is perfectly valid and will work as expected.

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

Watcher scheduling does not affect this behavior. Scheduled watchers do pull automatically at some point later, and if nothing else reads a watched reactive function, it _will_ run when the watcher flushes. BUT, if the value is read earlier, it will run on-demand and cache the result, which will then be read by the watcher. In effect, watchers act as a guarantee that the reactives will rerun automatically _eventually_, but if you need to speed that process up, you can at any time!

## Active Watchers and Relays

By default, without introducing watchers, relays are _inert_. If you access a relay it will not activate and start updating, it will just return its current value.

```js
import { relay } from 'signalium';

const logger = relay(() => {
  console.log('subscribed');

  return () => console.log('unsubscribed');
});

logger(); // logs nothing
```

This value will still be tracked by any reactive functions that use it, but the relay itself will never activate. The reason for this comes down to _resource management_ - that is to say, we want to only consume system resources when we need them, and we want to free them up when they're no longer needed.

With standard and even async values, this is not really an issue because they _mostly_ use memory, and that will _mostly_ naturally be cleaned up by garbage collection (ignoring promise lifecycle, abort signals, etc. for simplicity here). Most types of relays, however, necessarily consume resources until they are _torn down_. Background threads, websockets, polling - all things that need some external signal that says they are no longer needed.

Watchers conceptually represent the parts of the app that are _active_: They are "in use", and should be updating or running background tasks and so on. These are the exit points where your signals are writing to _something_ external, and that something is what is driving the lifecycle of your signal graph.

This leads us to _active status_. Watchers become **active** when 1 or more event listeners are added to them. When a node (a state, reactive function, or relay) is connected directly OR indirectly to an active watcher, it also becomes active. It remains active until it is disconnected from _all_ active consumers, at which point it is said to be **inactive**. Essentially, if you're directly or indirectly connected to a watcher, you are active, and if not, then you're inactive.

And last but not least: a relays _lifecycle_ is tied directly to whether or not its _active_. They run their setup upon activating, and run their deactivate function upon deactivating.

{% callout title="Additional Info" %}
This whole setup might seem a bit convoluted - why do we need to do this dance with watchers and relays? Why not just expose an `deactivate` method on relays and call that when they're no longer needed?

There are two main reasons for this. One is that this would leak some of the statefulness of relays. Remember, one of the main benefits of relays is that they are indistinguishable from standard async values. If these implementation details were exposed, you would need to manage it, and drill that management deeply from your components through the reactivity graph to every place it was used.

The other is related, but more conceptual. It comes back to what we want to do here - activate relays if they are in use, and deactivate them if they are no longer needed. "In use" is doing a lot of the heavy lifting here, how do we determine that?

Signalium defines a value as "in use" IFF it is connected to an active graph. This is important because the shape of that graph is _dynamic_ with signals, since we can [use values conditionally](/core/reactive-functions-and-state#conditional-usage). So you might connect to a websocket initially in some part of a reactivity tree, but then disconnect on the next update.

This dynamism makes manual relay management intractably hard. You would need to maintain references to all previous reactives that had relays, track whether or not they were reused, and call their destructors if not, all manually. This would be a pervasive pattern and would quickly infect an entire codebase and add mountains of complexity. It doesn't help that relay data sources tend to be _leaves_ that could be deeply nested in layers of reactives.

For all these reasons, relay management and active status is considered a _core part_ of signal lifecycle in Signalium. You can't have relays without active status, and you can't have asymmetric async without relays.
{% /callout %}

## Summary

And that covers the last major types of signals in Signalium! To summarize:

- Relays
  - Manage side-effects in a single, self-contained node with its own state
  - Implementation details are hidden, externally it works just like any other reactive promise
  - Primarily used for _asymmetric async_ (think UDP vs TCP)
  - Activate when _connected_ to an active watcher, and deactivate when _disconnected_ from all active watchers
- Watchers
  - Represent the active parts of the app
  - How state gets read from Signalium to external consumers
  - Schedules and "pulls" asynchronously
  - Activates when listener added with `addListener`

Now we just have one last core feature left: Contexts.
