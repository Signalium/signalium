---
title: Signals and Reactive Functions
nextjs:
  metadata:
    title: Signals and Reactive Functions
    description: Understanding signals and reactive functions in Signalium
---

At it's core, Signalium is a framework for defining and working with _signals_ and _reactive functions_.

- **Signals** are mutable values that can be reacted to.
- **Reactive functions** are functions that consume signals, and produce some output _derived_ from those signals.

Importantly, when a signal updates, any reactive function that _used_ the signal will also update automatically. One metaphor that is often used to describe this structure is spreadsheets. You can think of a reactive function as a _formula cell_ in a spreadsheet. It references other cells and then derives a value from them, perhaps summing up a number of cells to get the total. Whenever we update one of those cells, the formula cell _automatically_ updates with the latest value.

Reactive functions work the same way - they update whenever the signals they consume update, and they do so lazily when they are used.

## Signals

Signals are simple objects with a `value` property that contains the current value of the signal. You can create a signal using the `signal` function:

```ts
import { signal } from 'signalium';

const num = signal(1);
console.log(num.value); // 1
```

Whenever you read the value of a signal, it will be _consumed_ by the current reactive context. This is why signals are objects and not just standard variables - we need to know when the signal is _accessed_ in order to know when to update the reactive functions that depend on it.

You can update the value directly by setting the `value` property, or you can use the `update` method to update the value in place _without_ consuming the previous value.

```ts
num.value = 2;
console.log(num.value); // 2

num.update((v) => v + 1);
console.log(num.value); // 3
```

Conceptually, signals act as an annotation of sorts for mutable state within your application. By wrapping mutable values with a signal, we can more easily track and understand how state _changes_ over time in our application. Any standard variable or object is non-reactive by default, and we can assume that even if it does change, it won't affect the output of any reactive functions.

```ts
// Even though it's a `let` variable, it's not reactive and shouldn't
// affect the output of any reactive functions
let numVar = 1;

// By wrapping the value in a signal, we know it's reactive and we can
// expect it to change over time
const numSignal = signal(1);
```

This makes it very much easier to reason about the state of your application and how it changes over time, because all of the _root values_ that make up the state of your application are explicitly annotated as signals.

Now, let's move on to reactive functions.

## Reactive Functions

Creating a reactive function is as simple as wrapping your function definition with `reactive()`:

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

Reactive functions are memoized by default. This means that if the parameters passed to the function do not change, and the signals accessed by the function do not change, the function will return the same value as the last time it was called.

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
- Reactive function results are stored _weakly_, so if they are no longer in use they will be automatically cleaned up. If a function is used within a component or watcher, then it will be kept alive as long as that component or watcher is active, but outside of that, it may run more often as the previous result is cleaned up.

{% /callout %}

So far, reactive functions work just like normal functions. They can receive parameters and return values, and they're indistinguishable from a normal function from the outside, except that they are memoized. Now, let's introduce signals.

### Using signals in reactive functions

When you access a signal inside of a reactive function, the function becomes _entangled_ with that state. Whenever the state updates, the function will be invalidated and rerun the _next time_ it is used.

```ts
const log = reactive((signal) => {
  // we get the value of the signal, entangling it with `log`
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

You can pass signal values as parameters, or you can access them directly if they're in scope. The reactive function will update when the value changes, either way.

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

### Nested reactive functions

Reactive function can be nested inside of other reactive functions, and they will properly propagate updates to their parents.

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

### Conditional usage

Signals and reactive functions can also be called _conditionally_. They are not dependent on the runtime order remaining static, so if the order changes based on some value, everything will still work as expected.

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

### Update timing

Reactive functions be dirtied _immediately_ when state signals are updated. There is no wait period or delay for the next render cycle. If you change the value of a signal, and then call the reactive function, it will be dirtied and rerun immediately.

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

## Signal purity

As we mentioned before, reactive functions are _memoized_ based on the passed parameters and the signals they access. You might be wondering, how does this work if we're accessing mutable or global state within the function? Are there guarantees, similar to the types of guarantees that [pure functions](https://en.wikipedia.org/wiki/Pure_function) give?

Logically, we know that the signal state is always entangled with the reactive functions that access it, so any changes to the signal will be propagated to any reactive function that depends on it. This means that we can memoize reactive functions safely even when they access mutable or global state, _as long as that state is contained within a signal_. If that is true, then we can say that a reactive function is _signal-pure_.

{% callout title="Definition: Signal-Pure" %}
We can say that a reactive function is _signal-pure_ IFF:

1. All mutable state used within the function is contained within state signals, AND
2. Given the same parameters and state signals (with the same values), it always returns the same result.

{% /callout %}

Signal purity is what allows us to reuse memoized signal values in many different places based solely on the parameters passed to them and the signals that they access (directly or indirectly). It also ensures that when a signal changes, that change is propagated upward through all of the reactive functions that depend on it, ultimately updating any UI components or other watchers that depend on it. These components then know that they need to call the function again to get the latest value and rerender if necessary, completing the reactivity loop and ensuring that the application is always up to date.

## Summary

Reactive functions and state are the two most core primitives in Signalium, and together they cover almost all _synchronous_ computation. To summarize what we learned:

- Signals
  - Is created with `signal('initial value')`
  - Accessed via `signal.value`
  - Updated via `signal.value = 'new value'`
- Reactive Functions
  - Are cached JS functions that work just like standard functions (e.g. they can receive parameters and return values, and they're indistinguishable from a normal function from the outside).
  - Only rerun if the _parameters_ they receive are different, OR if any _state_ they access has been updated.
  - Rerun _lazily_ when they are accessed, and don't rerun if they are no longer used.
  - Rerun from _innermost_ to _outermost_ function when state has changed.

Next, let's discuss _reactive promises_.
