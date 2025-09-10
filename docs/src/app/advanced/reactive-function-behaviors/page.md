---
title: Reactive Function Behavior in Depth
nextjs:
  metadata:
    title: Reactive Function Behavior in Depth
    description:
---

This guide explains some of the more advanced behaviors of Reactive Functions in Signalium, including how to extend parameter equality, indirect access techniques, and how minimal re-execution works and maintains consistency.

## Extending Parameter Equality

To extend the parameter diffing, you can use the `registerCustomHash` utility function. This allows you to assign a custom hashing function to a class. This function should return a unique number that represents that specific value - it can be an id, the combined hash of several properties, or your own unique schema. The important thing is that the returned value of the function is the same if the two values are considered equal.

```js
import { registerCustomHash, hashValue } from 'signalium';

class Foo {
  a = 1;
  b = 2;
}

registerCustomHash(Foo, (foo) => {
  return hashValue([foo.a, foo.b]);
});

const log = reactive((obj) => {
  console.log(obj.val);
});

log(new Foo()); // 1
log(new Foo()); //
```

If you want to have more fine-grained control over parameter equality, you can pass a `paramKey` function to the Reactive Function definition. This function should generate a _unique string key_ for the parameters it receives, but other than that has no constraints.

```js
class Foo {
  a = 1;
  b = 2;
}

const log = reactive(
  (obj) => {
    console.log(obj.a);
  },
  {
    paramKey(foo) {
      return String(foo.a) + String(foo.b);
    },
  },
);

log(new Foo()); // 1
log(new Foo()); //
```

## Indirect access

Signals can be accessed _anywhere_ inside of a Reactive Function. This means that you can access them directly OR indirectly, for instance by calling another function.

```ts
const num = signal(1);

function doLog() {
  // even though we access the state inside this plain function, `log`
  // will still track that it was used.
  console.log(num.value);
}

const log = reactive(() => {
  doLog();
});
```

We call this _auto-tracking_, and this implicit entanglement allows you to use _plain functions_ more often without having to make them "signal-aware". Consider the following example:

```js
class User {
  firstName = signal('Tony');
  lastName = signal('Stark');
}

const user = new User();

const getFullName = reactive(() => {
  return `${user.firstName.value} ${user.lastName.value}`;
});
```

In an alternative design, we could instead pass a `get` function in to `reactive()` and use that to access the value, which would make it somewhat clearer when we are consuming the values:

```js
class User {
  firstName = signal('Tony');
  lastName = signal('Stark');
}

const user = new User();

const getFullName = reactive((get) => {
  return `${get(user.firstName)} ${get(user.lastName)}`;
});
```

Now, we might have multiple contexts where we want to read and format a user's full name, such as on the server or in event handlers, etc. And sometimes they may or may not need reactivity. This applies to many types of functions and much business logic in apps, and it's one of the main reasons why Hooks were so effective - they preserved the ability to use _plain functions_, without needing to worry about drilling the details down or making multiple versions of the same method.

With Signalium's tracking semantics, we can also preserve this by leveraging indirect access.

```js
class User {
  _firstName = signal('Tony');
  _lastName = signal('Stark');

  get firstName() {
    return this._firstName.value;
  }

  set firstName(v) {
    this._firstName.value = v;
  }

  get lastName() {
    return this._lastName.value;
  }

  set lastName(v) {
    this._lastName.value = v;
  }
}

const user = new User();

const getFullName = reactive(() => {
  return `${user.firstName} ${user.lastName}`;
});
```

In this example, the `User` class hides the details of the state Signals behind getters and setters, making them appear and behave just like normal properties. However, when we call `getFullName` inside of a Reactive Function, those states will be tracked as dependencies, and any updates to them will bust the cache.

What's important here is that `getFullName` does not need to _know_ about these details. We could update our implementation to add or remove reactive properties without having to make any changes to the functions that use them. Or, we could make non-reactive versions of classes and interfaces and use them interchangeably.

```js
class ReadOnlyUser {
  firstName = 'Carol';
  lastName = 'Danvers';
}
```

This generally reduces overall boilerplate and glue code, and encourages more shared utility functions and plain-old functional JavaScript. And importantly, it means less of your code is tied to a _specific_ reactivity model, making it portable and easier to reuse with different tools.

## Minimal Re-execution

You might be wondering how we can both:

1. Guarantee that we only rerun a function if some of its child functions have changed
2. Also only rerun a function lazily if it is needed, even conditionally

For example, in this hook:

```js
const getLeftValue = reactive(() => {
  /**/
});
const getRightValue = reactive(() => {
  /**/
});
const getCurrentDirection = reactive(() => {
  /**/
});

const getValue = reactive(() => {
  return getCurrentDirection() === 'left' ? getLeftValue() : getRightValue();
});
```

The first pass will cache both `getValue` and `getLeftValue` (assuming the initial direction is `'left'`). Now let's say we made both of these changes at the same time:

1. Update `getCurrentDirection()` to `'right'`
2. Update `getLeftValue()` to any new value

Following our algorithm, you might think that both `getCurrentDirection()` and `getLeftValue()` would need to re-execute before we could rerun `getValue()`. However, this is not the case because of one last nuance: We always rerun dirty children in the _same_ order that they were cached in.

So, when we go to check `getValue()`, it first checks `getCurrentDirection()` to see if it has changed. If it _has_, then we know that our function needs to be checked, so we immediately stop checking children and we rerun `getValue()`. Because `getCurrentDirection()` has changed, we no longer execute the branch that calls `getLeftValue()`, and it does not rerun.

Now, let's start over and say that we trigger an update `getCurrentDirection()` such that it still needs to rerun, but it ends up returning `'left'` again. In this case, we know it is safe to move on and check `getLeftValue()` because:

1. All mutable state used within the function should be contained within a state signal.
2. Therefore, we _know_ that anything that could affect the outcome of the conditional would have been called and tracked prior to `getLeftValue()`.
3. If all prior values have stayed the same, then the conditional could not have changed and `getLeftValue()` would be called again if we were to rerun the function.

Thus, `getLeftValue()` and other conditional reactives are only ever rerun if they _absolutely_ need to, ensuring maximum efficiency and minimal re-execution complexity.

## Manual invalidation with Notifiers

In some cases, you may want to manually invalidate a Reactive Function. This is often a more advanced use case, but it can be useful in certain situations. For instance, if you are using a Reactive Function to fetch data from an API, you may want to manually invalidate the Reactive Function when the user navigates away from the page. You can do this with a Notifier.

Notifiers are a special type of Signal that have no value. Instead, they expose two methods: `consume` and `notify`.

```ts
export interface NotifierSignal {
  consume(): void;
  notify(): void;
}
```

You can consume a Notifier inside of a Reactive Function, and you can notify it to invalidate it.

```ts
const n = notifier();

let count = 0;

const result = reactive(() => {
  n.consume();
  return count;
});

result(); // 0

count++;

result(); // 0

n.notify();

result(); // 1
```

In general, Notifiers are a powerful tool for manual invalidation of Reactive Functions, and they can be used to create a variety of complex behaviors. You should generally avoid using them unless you have a very specific use case for them, such as manually invalidating Reactive Functions that are being used in a data layer.
