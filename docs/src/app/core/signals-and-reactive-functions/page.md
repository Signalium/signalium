---
title: Signals and Reactive Functions
nextjs:
  metadata:
    title: Signals and Reactive Functions
    description: Understanding Signals and Reactive Functions in Signalium
---

At its core, Signalium is a framework for defining and working with _signals_ and _reactive functions_.

- **Signals** are mutable values that can be reacted to.
- **Reactive Functions** are functions that consume Signals, and produce some output _derived_ from those Signals.

Importantly, when a Signal updates, any Reactive Function that _used_ the Signal will also update automatically. One metaphor that is often used to describe this structure is spreadsheets. You can think of a Reactive Function as a _formula cell_ in a spreadsheet. It references other cells and then derives a value from them, perhaps summing up a number of cells to get the total. Whenever we update one of those cells, the formula cell _automatically_ updates with the latest value.

Reactive Functions work the same way - they update whenever the Signals they consume update, and they do so lazily when they are used.

## Signals

Signals are simple objects with a `value` property that contains the current value of the Signal. You can create a Signal using the `signal` function:

```ts
import { signal } from 'signalium';

const num = signal(1);
console.log(num.value); // 1
```

Whenever you read the value of a Signal, it will be _consumed_ by the current reactive context. This is why Signals are objects and not just standard variables - we need to know when the Signal is _accessed_ in order to know when to update the Reactive Functions that depend on it.

You can update the value directly by setting the `value` property, or you can use the `update` method to update the value in place _without_ consuming the previous value.

```ts
num.value = 2;
console.log(num.value); // 2

num.update((v) => v + 1);
console.log(num.value); // 3
```

Conceptually, Signals act as an annotation of sorts for mutable state within your application. By wrapping mutable values with a Signal, we can more easily track and understand how state _changes_ over time in our application. Any standard variable or object is non-reactive by default, and we can assume that even if it does change, it won't affect the output of any Reactive Functions.

```ts
// Even though it's a `let` variable, it's not reactive and shouldn't
// affect the output of any Reactive Functions
let numVar = 1;

// By wrapping the value in a Signal, we know it's reactive and we can
// expect it to change over time
const numSignal = signal(1);
```

This makes it very much easier to reason about the state of your application and how it changes over time, because all of the _root values_ that make up the state of your application are explicitly annotated as Signals.

Now, let's move on to Reactive Functions.

## Reactive Functions

Creating a Reactive Function is as simple as wrapping your function definition with `reactive()`:

```ts
import { reactive } from 'signalium';

const add = reactive((a: number, b: number) => {
  return a + b;
});
```

You can then use your function just like any other function:

```ts
const ret = add(1, 2); // 3
```

Reactive Functions are memoized by default. This means that if the parameters passed to the function do not change, and the Signals accessed by the function do not change, the function will return the same value as the last time it was called.

```ts
const log = reactive((val) => {
  console.log(val);
});

log(1); // 1
log(1); //

log(2); // 2
```

{% callout title="Memoization Notes" %}

- Parameters are diffed _semi-deeply_ - plain objects, arrays, and primitive values are deeply compared, but any kind of class instance that is not a plain object is compared via reference.
- Reactive Function results are stored _weakly_, so if they are no longer in use they will be automatically cleaned up. If a function is used within a component or other observer, then it will be kept alive as long as that component or observer is active, but outside of that, it may run more often as the previous result is cleaned up.

{% /callout %}

So far, Reactive Functions work just like normal functions. They can receive parameters and return values, and they're indistinguishable from a normal function from the outside, except that they are memoized. Now, let's introduce Signals.

### Using Signals in Reactive Functions

When you access a Signal inside of a Reactive Function, the function becomes _entangled_ with that state. Whenever the state updates, the function will be invalidated and rerun the _next time_ it is used.

```ts
const log = reactive((signal) => {
  // we get the value of the Signal, entangling it with `log`
  console.log(signal.value);
});

const num = signal(1);

log(num); // 1
log(num); //

// updating the state causes log to rerun, even though we passed
// the same parameters
num.value = 2;
log(num); // 2
```

You can pass Signal values as parameters, or you can access them directly if they're in scope. The Reactive Function will update when the value changes, either way.

```ts
const num = signal(1);

const log = reactive(() => {
  // we reference the state directly here rather than as a parameter
  console.log(num.value);
});

log(); // 1
log(); //

// updating the state causes log to rerun
num.value = 2;
log(); // 2
```

### Nested Reactive Functions

Reactive Functions can be nested inside of other Reactive Functions, and they will properly propagate updates to their parents.

```ts
const a = signal(1);
const b = signal(2);
const c = signal(3);

const addAB = reactive(() => {
  return a.value + b.value;
});

const addABC = reactive(() => {
  return addAB() + c.value;
});

console.log(addABC()); // 6

a.value = 2;
console.log(addABC()); // 7

c.value = 4;
console.log(addABC()); // 8
```

Functions do not propagate if their result is the same as the previous result, because then the parent function should have the same result as well, so no update is necessary.

```ts
const a = signal(1);
const b = signal(2);
const c = signal(3);

const addAB = reactive(() => {
  console.log('addAB');
  return a.value + b.value;
});

const addABC = reactive(() => {
  console.log('addABC');
  return addAB() + c.value;
});

// addAB and addABC both log
console.log(addABC());

a.value = 2;
b.value = 1;
// addAB logs, but addABC does not because the
// result is the same and propagation was stopped
console.log(addABC());
```

This ensures that we are not rerunning more code than is needed on any given change.

### Conditional Usage

Signals and Reactive Functions can also be called _conditionally_. They are not dependent on the runtime order remaining static, so if the order changes based on some value, everything will still work as expected.

```ts
const leftValue = signal(1);
const rightValue = signal(2);

const direction = signal<'left' | 'right'>('left');

const leftValue = reactive(() => {
  return leftValue.value;
});
const rightValue = reactive(() => {
  return rightValue.value;
});

const getCurrentValue = reactive(() => {
  console.log('getCurrentValue');
  return direction.value === 'left' ? leftValue() : rightValue();
});

// memoizes like normal
getCurrentValue(); // logs 'getCurrentValue'
getCurrentValue(); //

// if we update the left value, it reruns
leftValue.value = 2;
getCurrentValue(); // logs 'getCurrentValue'

// if we update the direction, it reruns
direction.value = 'right';
getCurrentValue(); // logs 'getCurrentValue'
getCurrentValue(); //

// now, if we update the right value, it reruns
rightValue.value = 3;
getCurrentValue(); // logs 'getCurrentValue'

// but if we update the left value, it does NOT rerun
// because the left value is no longer being used
leftValue.value = 3;
getCurrentValue(); // logs nothing
```

Since values are used lazily, functions will only rerun when the _latest_ values they use have changed. In this example, when we change the direction to `right`, the left value is no longer being used, so updating it does not cause `getCurrentValue` to rerun or even be checked.

### Update Timing

Reactive Functions be dirtied _immediately_ when state Signals are updated. There is no wait period or delay for the next render cycle. If you change the value of a Signal, and then call the Reactive Function, it will be dirtied and rerun immediately.

```ts
const num = signal(1);

const log = reactive(() => {
  console.log(num.value);
});

log(); // logs 1

num.value = 2;
log(); // logs 2
```

This way, your outputs are always up to date with the latest values, even if you just updated them.

## Signal Purity

As we mentioned before, Reactive Functions are _memoized_ based on the passed parameters and the Signals they access. You might be wondering, how does this work if we're accessing mutable or global state within the function? Are there guarantees, similar to the types of guarantees that [pure functions](https://en.wikipedia.org/wiki/Pure_function) give?

Logically, we know that the Signal state is always entangled with the Reactive Functions that access it, so any changes to the Signal will be propagated to any Reactive Function that depends on it. This means that we can memoize Reactive Functions safely even when they access mutable or global state, _as long as that state is contained within a Signal_. If that is true, then we can say that a Reactive Function is _signal-pure_.

{% callout title="Definition: Signal-Pure" %}
We can say that a Reactive Function is _signal-pure_ IFF:

1. All mutable state used within the function is contained within state signals, AND
2. Given the same parameters and state signals (with the same values), it always returns the same result.

{% /callout %}

Signal purity is what allows us to reuse memoized Signal values in many different places based solely on the parameters passed to them and the Signals that they access (directly or indirectly). It also ensures that when a Signal changes, that change is propagated upward through all of the Reactive Functions that depend on it, ultimately updating any UI components or other observers that depend on it. These components then know that they need to call the function again to get the latest value and re-render if necessary, completing the reactivity loop and ensuring that the application is always up to date.

### Creating Signals within Reactive Functions

You can create Signals in Reactive Functions, but these Signals will _not_ be persistent across reruns like `useState` would be. For instance, consider the following example:

```ts
let initialCount = signal(0);

const getCounter = reactive(() => {
  return signal(initialCount.value);
});

const counter = getCounter();

counter.value += 5;
console.log(counter.value); // 5

const counter2 = getCounter();

console.log(counter2.value); // 5
console.log(counter === counter2); // true

initialCount.value += 10;

const counter3 = getCounter();

console.log(counter3.value); // 10
console.log(counter.value); // 5
console.log(counter === counter3); // false
```

Stepping through this:

1. We call `getCounter` initially and it creates a new Signal with the value of `initialCount`. This entangles `initialCount` with `getCounter`, so it will rerun when `initialCount` updates.
2. When we call `getCounter` again without updating `initialCount`, it returns the same Signal that was created the first time, because it's still memoized.
3. We update `initialCount` and call `getCounter` again. This creates a new Signal with the new value of `initialCount`.
4. We can see that the new Signal is different from the previous one

This behavior is expected and intentional, and it's a core part of how Signalium works. If you want to create a persistent Signal, you can do so by creating it outside of the Reactive Function and then passing it in as a parameter. By ensuring that Reactive Functions do not have persistent state between runs, we maintain signal-purity and can safely memoize the result of the function and share it between all usages of the function.

By contrast, if we introduce persistent state to the function, we end up with a dilemma: Most cases where we want persistent state are cases where that state would _diverge_ based on the context in which the function is run. Consider a hook that models and tracks the state of a dropdown menu. It might look like this:

```ts
const useDropdownState = () => {
  const [isOpen, setIsOpen] = useState(false);

  const toggleIsOpen = () => {
    setIsOpen((isOpen) => !isOpen);
  };

  return {
    isOpen,
    toggleIsOpen,
  };
};

export const Dropdown = ({ children }: { children: React.ReactNode }) => {
  const { isOpen, toggleIsOpen } = useDropdownState();

  return (
    <div ref={ref}>
      <button onClick={toggleIsOpen}>Toggle</button>
      {isOpen && <div>{children}</div>}
    </div>
  );
};
```

In this example, `useDropdownState` should logically create a different instance of the state for each dropdown, because it's meant to model the state of a _specific_ dropdown menu. But, this breaks purity, because we're introducing an _implicit_ dependency on the component instance. This means either:

1. We need to rerun every reactive function again for each component instance, because there's no way of knowing which functions will use this implicit dependency until they are called, OR
2. We need to make the dependency _explicit_ instead of implicit

Implicit dependencies are a major source of complexity and bugs in applications, and requiring each and every Reactive Function to be aware of this implicit dependency would also introduce a lot of overhead. So, Signalium makes the opinionated choice to _disallow_ state declarations within Reactive Functions. If your component needs to manage state, then you should declare it outside of the Reactive Function and pass it in as a parameter.

There are ways to do this without breaking signal-purity. For instance, you can pass in a unique identifier to the function for it to memoize on:

```ts
import { component, reactive, signal } from 'signalium';
import { useState } from 'react';

const getDropdownState = reactive((id: string) => {
  const isOpen = signal(false);

  const setIsOpen = (isOpen: boolean) => {
    isOpen.value = isOpen;
  };

  const toggleIsOpen = () => {
    setIsOpen((isOpen) => !isOpen);
  };
});

let DROPDOWN_ID = 0;

// Note: We'll cover the component helper later on in the React section, for now
// just know that it's a function that makes a React component reactive
export const Dropdown = component(({ children }: { children: React.ReactNode }) => {
  const id = useState(DROPDOWN_ID++);
  const { isOpen, toggleIsOpen } = getDropdownState(id);

  return (
    <div ref={ref}>
      <button onClick={toggleIsOpen}>Toggle</button>
      {isOpen && <div>{children}</div>}
    </div>
  );
});
```

Alternatively, you can create a persistent Signal within the Reactive Function and then pass it in as a parameter, or use an element ref. Any type of parameter will work - it just needs to be unique to the component instance.

### Mutations within Reactive Functions

While generally frowned upon, it is still not an uncommon pattern in React Hooks to mutate some state during the runtime of a hook. It might be in a managed `useRef` value, or via an effect that writes and propagates an update immediately. There are cases where this is necessary, but much of the time it arises due to poor data architecture or as a quick hack to get around an issue. In any case, it is problematic because it can make your code as a whole less _predictable_, it can cause infinite re-rendering, and it can lead to [spooky action at a distance](<https://en.wikipedia.org/wiki/Action_at_a_distance_(computer_programming)>). But one example of when this might be useful is when you need to reset state in response to another state change:

```ts
const useCustomHook = ({ value }) => {
  const [counter, setCounter] = useState(0);

  useEffect(() => setCounter(0), [value]);
};
```

This is not the [recommended way of resetting state in React](https://react.dev/learn/preserving-and-resetting-state#resetting-state-at-the-same-position), but there are cases where it's _difficult_ to avoid for a variety of reasons.

In Signalium, this is also something that should generally be **avoided** in Reactive Functions for the same reasons, and because it may break signal-purity. If you are mutating state in a Reactive Function, consider:

1. Mutating both pieces of state in the same callback or user action (if you're here, you probably already thought about that and it's not really realistic in your use case, but it's always good to be sure).
2. "Lifting" that state to a shared context or parent component and passing it down so that everything downstream of that reactive can derive directly from it.
3. If you are resetting state whenever a value changes, leveraging the _caching_ semantics of reactive function (discussed in the previous section) to reset it by _recreating it_ instead.

That said, there is no blanket prohibition on mutating state _anywhere_ (i.e. it will not throw an error if you choose to do so). While strongly recommended against, if you're sure it's the best (or only) way, then nothing prevents you from doing it.

## Summary

Signals and Reactive Functions are the two most core primitives in Signalium, and together they cover almost all _synchronous_ computation. To summarize what we learned:

- Signals
  - Created with `signal('initial value')`
  - Accessed via `signal.value`
  - Updated via `signal.value = 'new value'`
- Reactive Functions
  - Defined with `reactive(() => { ... })`
  - Are cached JS functions that work just like standard functions (e.g. they can receive parameters and return values, and they're indistinguishable from a normal function from the outside).
  - Only rerun if the _parameters_ they receive are different, OR if any _state_ they access has been updated.
  - Rerun _lazily_ when they are accessed, and don't rerun if they are no longer used.
  - Rerun from _innermost_ to _outermost_ function when state has changed.
- Signal Purity
  - A Reactive Function is _signal-pure_ IFF:
    1. All mutable state used within the function is contained within state signals, AND
    2. Given the same parameters and state signals (with the same values), it always returns the same result.
  - You can create signals within Reactive Functions, but they will not be persistent across reruns like `useState` would be.
  - Mutating state within Reactive Functions is generally discouraged, but not prohibited.

Next, let's discuss _Reactive Promises_.
