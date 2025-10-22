---
title: Code Transforms and Async Context
nextjs:
  metadata:
    title: Code Transforms and Async Context
    description:
---

Signalium currently requires you to use a Babel preset to enable the full set of features. This is a bit annoying, because the JavaScript community as a whole has been moving away from transforms and towards native JavaScript features over time, and more and more apps and frameworks are using non-Babel-based transpilers as well to improve DX and performance, so requiring a transform to use Signalium is a bit of a hindrance. However, due to the current limitations of the platform, there isn't really another option for some of the more important behaviors we want to enable.

The good news is that the most critical of those gaps is _likely_ going to be addressed in the future by the [async context proposal](https://github.com/tc39/proposal-async-context) in TC39. If that proposal or something like it is accepted, then most of these transforms will no longer be necessary and will be removed in future versions.

In the meantime, Signalium currently provides the Babel preset, and there's a goal to provide an [SWC plugin](https://swc.rs/docs/plugin/selecting-swc-core) as well so that we can provide a faster, more performant alternative to the Babel preset.

This guide discusses the reasons for each transform in depth for documentation purposes, and in case anyone wants to help out with the SWC plugin. There are 3 transforms in total:

- `signaliumAsyncTransform`
- `signaliumPromiseMethodsTransform`
- `signaliumCallbackTransform`

The first two are about enabling async context, which is the most important gap that is required. The third one is about memoizing callbacks, which improves performance but is less important.

## Async Context Transforms

Signalium tracks Signal usage _implicitly_. When running a Reactive Function, we set a global context variable that is used to track which Signals are being used, and whenever a Signal is accessed or a Reactive Function is called, we add it to the current context. This is how most Signal-based frameworks work, including Preact, Vue, Solid, and others, and it generally looks something like this:

```ts
let getCurrentConsumer(): ReactiveFn | null = null;

export function runReactiveFunction<T>(fn: () => T): T {
  if (getCurrentConsumer()) {
    addDep(getCurrentConsumer(), fn);
  }

  const prevConsumer = getCurrentConsumer();

  try {
    getCurrentConsumer() = fn;
    return fn();
  } finally {
    getCurrentConsumer() = prevConsumer;
  }
}
```

This is a simplification, of course, but the general idea is that you set the current context or consumer, try to run the function, and either way if it succeeds or fails, you restore the previous context to ensure that we don't leak context to the enclosing function.

Where it gets interesting is tracking _asynchronous_ signal usage. Consider the following example:

```ts
const query = signal('https://api.example.com/data');
const format = signal('json');

const loadAndProcessData = reactive(async () => {
  const response = await fetch(query.value);
  const data = await response.json();

  return processData(data, format.value);
});
```

Now that we're introducing asynchrony, we need to think about what happens if multiple functions are running interleaved with each other. If we try to make our `runReactiveFunction` async, we run into a problem:

```ts
let getCurrentConsumer(): ReactiveFn | null = null;

export async function runReactiveFunction<T>(fn: () => T): Promise<T> {
  if (getCurrentConsumer()) {
    addDep(getCurrentConsumer(), fn);
  }

  const prevConsumer = getCurrentConsumer();

  try {
    getCurrentConsumer() = fn;
    return await fn();
  } finally {
    getCurrentConsumer() = prevConsumer;
  }
}

// ...

const runA = reactive(async () => {
  await sleep(1000);
});

const runB = reactive(async () => {
  await runA();
});

const runC = reactive(async () => {
  await sleep(5000);
  await runB();
});

runB();
runC();
```

Let's step through this:

1. `runB` is called, which sets `getCurrentConsumer()` to `runB`.
2. `runB` calls `runA`, which adds `runA` to the dependencies of `runB`, and sets `getCurrentConsumer()` to `runA`.
3. `runB` then waits for `runA` to complete.
4. Meanwhile, `runC` is called, which sets `getCurrentConsumer()` to `runC` and waits on a sleep.
5. `runA` completes, and `getCurrentConsumer()` is set to `runB`.
6. `runB` completes, and `getCurrentConsumer()` is set to `null`.
7. When `runC`'s sleep completes, `getCurrentConsumer()` is `null`, so we don't add `runB` to the dependencies of `runC`. This is a bug.

There are a lot of ways concurrency can mess up the implicit tracking context like this, so clearly we can't just `await` async functions in our tracking logic. What we need to do instead is to _restore_ the tracking context _after_ the async function has completed.

Unfortunately, with `async`/`await`, there simply is no way to do this at all.

The `await` keyword calls `.then()` on the promise it is applied to, and you might think "oh, we could make a custom promise, capture the context in that `.then()` call, and then restore it when the promise returns!", but that does not work because `.then()` is called in a microtask, meaning that the function has already fully executed by the time the `.then()` is called.

```ts
let IMPLICIT_VAR = 0;

const customPromise = {
  then: () => {
    console.log(IMPLICIT_VAR);
  },
};

const fn = async () => {
  await customPromise;
};

const runFn = async () => {
  IMPLICIT_VAR = 1;
  fn();
  IMPLICIT_VAR = 0;
};

runFn(); // logs 0, not 1
```

This is the gap that the [async context proposal](https://github.com/tc39/proposal-async-context) in TC39 is intended to address, because it turns out that implicit context is quite useful for a lot of things, not just tracking dependencies. It's basically essential for most telemetry frameworks, for instance.

In the meantime, there is a workaround: Generator functions.

Generators give us the ability to intercept the execution of a function at each `yield` point, and we can use that to restore the context after the function has completed. Generators were also used to polyfill Promises for a very long time, so making a transform that _basically_ reimplements Promise behavior is very doable. The rub is that we can't convert _all_ async functions everywhere to generators - that would have a much larger impact than we want to make and would make the output a lot harder to understand.

So, Signalium provides a transform that rewrites async functions into generators _only inside_ tracked calls (e.g. `reactive`, `task`, `relay`, `reactiveMethod`, `component`). This minimizes the impact on the codebase and keeps it scoped to _just_ Signalium code, so you won't see any other impacts on your codebase or app. If you only use Signalium in a few places, this will have a very minimal impact on your codebase. In addition, we also convert `Promise` static method calls such as `Promise.all` and `Promise.race` calls inside tracked calls to `ReactivePromise.*` calls, because plain `Promise.*` has the same issue as `await` in that it cannot be tracked by implicit contexts.

### Adding additional import sources

You can optionally add additional import sources to the transform to target more functions. This allows you to wrap Signalium functions in your own custom functions and still have them transform properly. Let's say you want to wrap `reactive` in your own custom function:

```ts
const myCustomReactive = (fn) => {
  // do something with args

  return reactive(fn);
};

// usage
import { myCustomReactive } from 'my-custom-signalium-wrapper';

const fn = myCustomReactive((a, b) => a + b);
```

To support this, you can pass the additional import sources to the transform:

```ts
import { signaliumPreset } from 'signalium/transform';

module.exports = {
  presets: [
    [
      signaliumPreset,
      {
        transformedImports: [
          ['myCustomReactive', /my-custom-signalium-wrapper/],
        ],
      },
    ],
  ],
};
```

### Limitation: Non-Signalium async functions

There is one major limitation to this approach: If a _normal_ async function is called by _reactive_ async function, then we enter right back into the same issue as before with tracking, because the Signalium transform does not apply to standard functions.

```ts
let stateA = signal(0);
let stateB = signal(0);

const normalAsyncFn = async () => {
  await sleep(1000);
  return stateA.value;
};

const reactiveAsyncFn = reactive(async () => {
  const a = await normalAsyncFn();
  return a + stateB.value;
});

await reactiveAsyncFn(); // 0

stateA.value = 1;
await reactiveAsyncFn(); // 0, did not update

stateB.value = 1;
await reactiveAsyncFn(); // 2, did update
```

Note that within the context of `reactiveAsyncFn`, we do still track properly, even after we await `normalAsyncFn`. So really all this means is that non-reactive promises are black boxes to Signalium — we can't track them or their dependencies for now.

If `AsyncContext` is accepted, this will no longer be an issue as we'll be able to keep context through _all_ async boundaries. In the meantime, you can generally avoid this by making sure that all async functions that use reactive state are themselves reactive. Since reactive async functions return reactive promises, and reactive promises are a superset of standard promises, this is _generally_ easy to do, though it does introduce some overhead with caching. In the future, we may add a way to define async functions that maintain context, but are _not_ cached, to avoid this overhead.

## Callback Transform

This transform is a bit different from the other two. The issue is that there isn't a way for us to introspect into _closure scopes_ in JavaScript (or in many languages). This is an understandable limitation as it would be a very, very powerful feature if it existed, and is potentially very dangerous. However, it means that we can't easily tell if the function has _logically_ changed.

Consider the following example:

```ts
let a = 1;
const makeCb = () => {
  return () => a;
};

const cb1 = makeCb();

a = 2;

const cb2 = makeCb();

console.log(cb1 === cb2); // false
console.log(cb1(), cb2()); // 2, 2
```

These callbacks are separate instances, but reference the same in scope variable and have the same function body, so they will always produce the same result. However, we could very easily create two callbacks that diverge:

```ts
let a = 1;
const makeCb = (b) => {
  return () => b;
};

const cb1 = makeCb(a);

a = 2;

const cb2 = makeCb(a);

console.log(cb1 === cb2); // false
console.log(cb1(), cb2()); // 1, 2
```

Because `a` is captured by the local variable passed to `makeCb`, it now produces a different result when called. This is the reason `useCallback` exists in React. We need to explicitly list the variables we depend on, so that we can detect when they change and re-create the callback if necessary.

In Signalium, even without the callback transform, this is a _less_ common case because of minimal graph re-execution. Since Reactive Functions only rerun when something they consume has _definitely_ changed, it means that we will be making fewer closures in general on each change overall. But there are still cases where you might see functions rerunning more often than expected. Consider cases where closures are passed simply as "configuration":

```ts
const getUser = reactive(async () => {
  const user = await runQuery({
    url: 'https://api.example.com/users',
    params: {
      id: '1',
    },
    format: (payload) => parseUser(payload),
  });
});
```

In this case, the `format` function is a callback that is passed in as a parameter, but it's never going to change because it doesn't reference any variables that are in scope. Still, if `runQuery` is a reactive function, it will see a new function each time and run a new query each time. This is a bit unexpected and not ideal.

The callback transform solves this by memoizing callbacks automatically:

```ts
const getUser = reactive(async () => {
  const user = await runQuery({
    url: 'https://api.example.com/users',
    params: {
      id: '1',
    },
    format: callback((payload) => parseUser(payload), 0, []),
  });
});
```

Now the callback will always be the same instance, and we won't see the extra query each time. Note that unlike `useCallback`, we're passing both a dependency array as the last variable AND a number before that. That number is the _index_ of the callback within the current Reactive Function. This allows us to have conditional callback declarations — otherwise, we would always have to call `callback` at the top of the function and follow Rules-of-Hooks-style execution order:

```ts
const getUser = reactive(async (extraData) => {
  const user = await runQuery({
    url: 'https://api.example.com/users',
    params: {
      id: '1',
    },
    format: extraData
      ? callback((payload) => parseUserWithExtraData(payload, extraData), 0, [
          extraData,
        ])
      : callback((payload) => parseUser(payload), 1, []),
  });
});
```

If you had to keep track of this yourself, it would be a lot of boilerplate! That's why we have a transform for this. With the transform, you don't need to worry about memoizing callbacks or keeping track of indices yourself — it's all handled for you for any callback defined within a Reactive Function.

### Limitation: Non-Signalium callbacks

Like the async transforms, the callback transform only applies to callbacks defined within Reactive Functions. If you define a callback outside of a Reactive Function, it will not be memoized.

```ts
// Non-reactive function definition
const getUser = async () => {
  const user = await runQuery({
    url: 'https://api.example.com/users',
    params: {
      id: '1',
    },
    format: (payload) => parseUser(payload),
  });
};
```

Each time `getUser` is called in this case, it will run with a new query because the callback is not memoized. There is unfortunately _no way around this_ while supporting conditional signal usage. We cannot define addresses for callbacks that we don't know about, and we can't know about all callbacks unless we go through every branch of code in general. This isn't even something that you can do manually, which is why `callback` is NOT public API - there isn't a point.

We would need to start following the Rules-of-Hooks _everywhere_ to make this work, and that's not something we want to do. So, just be aware that if you define a callback outside of a Reactive Function, it will not be memoized by default, and if you want it to be, you will need to _manually_ memoize it and extract the definition to shared scope such as a module.

### Will this be removed in the future?

Unlike the `AsyncContext` proposal, introspecting on closures is not something that is being actively explored in TC39 at the moment. We raised [this limitation in the Composites proposal](https://github.com/tc39/proposal-composites/issues/21) since it is _tangentially_ related, but the response has generally been skeptical, and with good reason. As mentioned before, this would be an _extremely_ powerful feature if it existed, and the consequences of that are difficult to reason about.

As Signals are explored more in depth, we will continue to explore ways we could add this capability to the platform. Callbacks also currently capture their async context, so it's still important for maintaining context through async boundaries for now. If `AsyncContext` is accepted, that portion of the transform will no longer be necessary, and the callback transform will become _technically_ optional, as reactive functions will just rerun a bit more often than they would otherwise. But because we want to be as performant as possible by default, it will still be recommended.
