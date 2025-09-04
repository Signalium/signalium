---
title: A Signals Deep Dive
nextjs:
  metadata:
    title: A Signals Deep Dive
    description:
---

{% callout title="Alternatively" %}
This article is a deep dive into the theory behind Signals and Signalium. If you're trying to jump into Signalium feet first and build something, you should instead [skip ahead to the core docs](/core/reactive-functions-and-state) and come back to this when you have time later.
{% /callout %}

Signalium is, on its face, a state management library that is built primarily for React applications. However, it also represents a _paradigm-shift_ in the way we think about state management in reactive applications - not just in React, but in _any_ JavaScript app.

Paradigm shifts like this usually require more than just skimming the documentation for them to sink in. If you take Signalium and simply rewrite your React application using the same patterns you used with hooks, you likely will see _some_ benefits in DX and performance. But, if you want to really get the most out of Signalium, then you need to understand _why_ it is necessary in the first place. What was it that led us to create a new state management system? What common problems is it solving that cannot be solved in other ways?

This page is a deep dive into the theory behind Signals and Signalium. At its core, the Signal represents a new _monadic_ data structure for reactivity, one that is as fundamental as the Promise was for async. We will dig why this structure is important, how it can be used to solve difficult functional-reactive problems, and what it could look like in the future of the language as a whole.

## First, a retrospective

When React Hooks first hit the frontend world back in [2018](https://www.youtube.com/watch?v=dpw9EHDh2bM), I was, like many others, immediately enamored by them. React had already proven the benefits of component-oriented view layers, and the benefits of functional programming were finally becoming accepted in the industry after decades of dominance by object-oriented programming. I was skeptical that the _entire_ view layer could be pushed into a "pure" functional style, but I was also curious, because at the time I was working on a very similar set of problems.

Back then, we were working on overhauling the Ember.js programming model holistically around an [early version](https://github.com/emberjs/rfcs/pull/410) of what would today be recognized as [Signals](https://github.com/tc39/proposal-signals), and one core issue we kept coming back to was _loading data_. Much like React pre-hooks, Ember components that wanted to load data outside of the framework's router had to rely on a variety of lifecycle hooks, and this dance of managing state and dynamically loading data was, to say the least, _very tricky_.

Hooks, with early utilities like [SWR](https://swr.vercel.app/) and [Tanstack Query](https://tanstack.com/query/latest), showed a different path toward solving this problem. One that looked a lot cleaner and easier to understand, that made the whole process of managing that state _self-contained_ in a way that wasn't really possible before. They essentially extended _reactivity_ beyond components and into the world of data loading, DOM mutation, and general side-effect management as a whole.

But in the years since their release, there have been more and more complications with the Hooks programming model. It's not uncommon these days for React devs to decry Hooks and the complexity that they add, and there have been more and more experiments with alternatives for state management such as [Legend State](https://legendapp.com/open-source/state/v3/) or [Jotai](https://jotai.org/) in the wider ecosystem.

The React team has been attempting to solve these issues with an [experimental compiler](https://react.dev/learn/react-compiler) that purports to automatically add calls to `useMemo`, `useCallback`, and `React.memo`, reducing the cognitive overhead that plagues hooks usages - but I don't think that this is going to work, for the simple reason that adding an additional layer of compiler magic which _further_ obfuscates the usage of hooks seems like it ultimately will add more fuel to the raging firestorm of emergent complexity. You can't dig yourself out of a hole, so to speak.

Meanwhile, on the other end of the JavaScript ecosystem, there has been an ongoing effort to standardize a new reactivity model built around **Signals**. Essentially every major frontend framework besides React - Angular, Vue, Svelte, Preact, Solid, and more - have more or less _independently_ arrived at the Signals design. Even Jotai and MobX in the React world are, essentially, Signals flavors in their own ways. There is enough independent discovery and convergent evolution here that it really does suggest that we've _found_ something interesting, at the least.

Up until recently though, none of us has really been able to put our finger on it. We _feel_ like Signals solve many of the common problems we face in Hooks, but explaining _why_ usually leads to a long explanation with a lot of different examples and edge cases and corner cases and so on. We struggled to find a principle behind it all for quite some time. But now, we have (and I'm really sorry for this in advance):

So.

The thing is.

It turns out that Signals are _reactive monads_, and Hooks are _not_.

---

I know, I know, [what even is a monad???](https://rmarcus.info/blog/2016/12/14/monads.html). It's one of those weird academic terms that is comically hard to explain (ironically, I think, because it's so _simple_ in the end that it really loops back around and becomes just incredibly _complex_). I promise not to get _too_ into the weeds on this, but it's important because it really is the _crux_ of the issue. My hypothesis is that the _vast_ majority of the complexity in Hooks-based code comes from this core issue - that they are fundamentally non-monadic.

Despite these issues, Hooks still have a _more intuitive_, and I would also say _more powerful_, API. As I got deeper into the design of Signals, I kept coming back to that magic that Hooks had first shown me all those years ago. They felt _so close_, like each had something the other was missing.

And after pondering it for the last 7-odd years, I think I've _finally figured it out_ with Signalium.

Signalium is a _general-purpose_ reactivity layer that focuses solely on making plain-old-JavaScript code _reactive_, in the same way that Promises made plain-old-JavaScript code _async_.

{% callout title="A Quick Note" %}
I also want to take a moment to thank all of the other engineers who contributed to this project, directly or indirectly. Specifically, my mentors on the Ember.js core team that started me down this path, the React team for providing the inspiration, and the wider Signals community for keeping the dream alive.
{% /callout %}

## Plain old (reactive) JavaScript

To explain what I mean here, we do need to get back to the "what is a monad" thing, so let's get that out of the way.

I had a computer science professor in college who taught us Haskell and had a whole section on monads, and we even implemented a `semicolon` monad to sequence things like an imperative language (which honestly just felt like trolling at that point), but I still couldn't really _grasp_ it.

When I first started my career and was learning Scala, one of my coworkers told me that a monad was "anything that implemented `map` and `flapMap`", which was also not really helpful. Over time I learned about more things that were monads, like `Result` and `Option`, and that helped a bit more as I started to dig into Rust and such.

But where it really finally hit me was with Futures, and by extension, Promises (and to be clear, I'm aware that [Promises are not really monads](https://stackoverflow.com/questions/45712106/why-are-promises-monads), but they are _close enough_ in purpose and, more importantly, they're familiar enough to every JavaScript dev that they provide a great reference point).

So, let's consider some code with Promises.

```ts
function loadAndProcessData(query) {
  return fetch(query)
    .then((response) => response.json())
    .then((data) => processData(data));
}
```

This code is pretty simple, but stepping back, let's think about what has to happen under the hood to make it all work.

1. First, we call the `loadAndProcessData` function, which then calls `fetch`, which returns a promise.
2. Then, we _yield_ back to the JavaScript event loop. So, the main JS thread is going to keep on executing other tasks and doing things while we wait on the `fetch` to return.
3. In order to make that work, we need to store the _current state_ of the function, including:
   1. The current variables in scope, so that we can restore them
   2. The line of code we're waiting on, so that we know which line to execute next
   3. The external promise returned by `loadAndProcessData`, so we can resolve it once all steps have been completed
4. All of these values are stored _somewhere_, and then when we return, we restore those values to the callstack and start executing again on the next line.

The exact details of how and where those values are stored don't really matter, because externally we don't really need to worry about them. That's all handled by the Promise (and JavaScript's closure/scope semantics).

Monads are essentially like a box that contains some _context_, and that box comes with a function that let's you take that context and transform it into _another_ box with the _next_ context in the sequence. In the case of [Options](https://en.wikipedia.org/wiki/Option_type) or [Results](https://en.wikipedia.org/wiki/Result_type), you're transforming the result of an operation (`Some`/`None` or `Ok`/`Err`) into whatever you were planning on doing next with those values, and handling the edge cases if there was _no_ value, or an error instead. In the case of Futures and Promises, the box has all of that context around the async operation, and `Promise.then` is the function that carries us on to the next step.

But the magic of monads is not just in what they are, but also how often they fit into an existing, perhaps just _slightly_ tweaked, syntax. With `async`/`await` syntax we can restructure our original Promise-based function to look much more like plain-old-JavaScript:

```ts
async function loadAndProcessData(query) {
  const response = await fetch(query);
  const data = await response.json();

  return processData(data);
}
```

This reads like synchronous code, but does all of the same async sequencing and transformations as our first example. Similar syntax exists for Options or Results in functional languages like Rust and, of course, Haskell, and if we think about this it should be maybe a bit obvious _why_ this works so well - after all, programming languages are inherently about _linguistically sequencing_ things, either via imperative steps (turned out that `semicolon` lesson _was_ useful after all), nested function calls, declarative dependencies, or some other means.

So, what does a _reactive_ monad look like?

And more importantly, how do we incorporate it in a way that is _fluid_ and _natural_ in our syntax?

## The Hooks version

Let's consider what the above might look like using hooks:

```ts
function useLoadAndProcessData(query) {
  const promise = useRef(fetch(query));

  const response = use(promise.current);
  const data = use(response.json());

  return processData(data);
}
```

This actually looks very similar overall to our `async`/`await` syntax, which is a great sign! Compare this to, say, Observables (another monad that is used for reactivity):

```ts
function createLoadAndProcessDataObservable(query: Observable<string>) {
  return query
    .map((query) => fetch(query))
    .map(async (res) => (await res).json())
    .map(async (data) => processData(await data));
}
```

This is a bit contrived (that _could_ just be a single `map` statement, or better libraries that handle the details of sequentially awaiting piped promise values), but you can see how as we break down each individual step, we start to introduce a lot of _complexity_ with Observables. It starts to look less and less like _plain_ JavaScript, and Hooks are looking a lot better in this regard.

The issue with the Hooks version, however, is how it works under the hood.

As we know, Hooks rerun whenever there _might_ be an update. This is why we have to constantly pass in our dependencies to every hook, and why all of the operations of hooks have to idempotent for the given set of arguments. What is happening in our example above is that we are rerunning all of the steps of the `useLoadAndProcessData` function that we _already ran_ in order to rebuild the previous state of the world, and we are _then_ advancing to the next step.

And it's not just that hook that we're rerunning - we're also rerunning _every_ other hook above it in the call stack, all the way up to the nearest component. This is where the complexity comes from. And this is why hooks are not _monadic_.

Imagine if this were the way that `async`/`await` syntax worked. We rerun the _entire_ function leading up to the currently active `await` statement. If all of those steps were fully idempotent and non-stateful, then that would _technically_ work. We could do that each time, and not really worry about capturing and restoring context fully in the Promise.

That may sound far-fetched to you, but going back to the days _before_ promises, maybe that would be a bit more appealing.

```ts
function useLoadAndProcessData(query, callback) {
  fetchCallback(query, (response) => {
    parseJson(response, () => {
      callback(processData);
    });
  });
}
```

It took me a good moment to dredge that syntax back up and think it through, and this has _so much_ extra complexity going on here. Imagine if we're trying to refactor a synchronous version of this function to make it more performant, and we suddenly need to refactor everything to use this `callback` pattern. And it's not just here - you would need to add that `callback` argument to _every_ non-async function that calls this one!

Detractors would note that this _also_ applies to Promises and `async`/`await`. If you make a function async, you now need to go and make every function that uses it async as well. But there is a _crucial_ difference here: It's a _lot_ harder to mess `async`/`await` up, because fewer lines of code need to change, and there is less "wiring" that has to occur.

With the `callback` pattern, you now need to:

1. Separate all of the code that comes _before_ the async operation from the code that comes _after_ it,
2. Ensure that the callback is called at the correct time to execute the function _above_ us in the call-stack,
3. Ensure that no code is accidentally left _after_ we schedule the callback in our function (because it could keep running and do more things in the meantime) AND after we call the callback passed to _our_ function (oh boy, this is getting to be a lot).

And that last part is doubly tricky because lots of clever devs _do_ want to make use of it from time to time. Yes, let's schedule something async _and_ keep on doing things! Or call the callback and get its return value and then do something else! Maybe we call the callback _twice_, or _three_ times!

You have much more _power_ with callbacks, is the point. And 99% of the time, you don't _need_ that power - it just makes it harder to rebuild and refactor and understand a codebase, in the end. This is why Promises (and later, `async`/`await`) were so successful in reducing complexity in async. It's not that they eliminated _all_ of the overhead or complexity, but they reduced _most_ of it in the common case.

But we've digressed, back to our thought experiment! We could _imagine_ that rather than using callbacks _or_ promises, we could do the same thing that React's `use` function does here - we could `throw` and halt execution:

```ts
const responses = new Map();
const parsed = new Map();

function useFetch(query) {
  if (responses.has(query)) {
    return responses.get(query);
  } else {
    fetchCallback(query, (response) => {
      responses.set(query, response);

      // Re-run the program after the async operation is done
      rerunProgram();
    });

    throw WAIT_FOR_ASYNC_EXCEPTION;
  }
}

function useParseJson(response) {
  if (parsed.has(response)) {
    return parsed.get(response);
  } else {
    parseJson(response, (json) => {
      parsed.set(response, json);

      // Re-run the program after the async operation is done
      rerunProgram();
    });

    throw WAIT_FOR_ASYNC_EXCEPTION;
  }
}

function useLoadAndProcessData(query) {
  const response = useFetch(query);
  const data = useParseJson(response);

  return processData(data);
}
```

You can see that we end up with a pretty similar looking high-level API, but we also know that the underlying code is rerunning _constantly_, each time a related async operation calls its callback. Again, in theory this is completely ok, because all of the operations that are called are idempotent and pure. But, we can also see how easy that would be to mess up.

For instance, let's say we decide to start integrating a telemetry library to gather performance information, and we want to get the total number of times we call `useLoadAndProcessData` so we can determine if it should be reduced. A naive implementation might look like:

```ts
function useLoadAndProcessData(query) {
  incrementCounter('fetching-data');
  const response = useFetch(query);
  const data = useParseJson(response);

  return processData(data);
}
```

But once we realize that this function will be called repeatedly, we can see that the `incrementCounter` method needs to deduplicate itself somehow. This is not as much of an issue with `async`/`await`:

```ts
async function loadAndProcessData(query) {
  incrementCounter('fetching-data');
  const response = await fetch(query);
  const data = await response.json();

  return processData(data);
}
```

This will only call `incrementCounter` once per full function execution, which is more of what we would expect if we can into this situation without any prior knowledge. You might point out that the hooks example also _deduplicates_ query calls, so it's more efficient overall though! And I would say yes, that's true, but it may or may not be the desired effect in some cases, and regardless, that would be _very easy_ to add to the async version as well:

```ts
const loadAndProcessData = memoize(async (query) => {
  incrementCounter('fetching-data');
  const response = await fetch(query);
  const data = await response.json();

  return processData(data);
});
```

Overall, if Promises worked more like Hooks, we can see that it would only add increased complexity and many gotchas and foot-guns that are currently avoided. As applications using that model grew, they would also start to experience a lot of the same emergent complexity we see from Hooks in general: Infinite rerender bugs caused by forgetting to memoize a callback; Performance issues caused by calling plain functions without `useMemo`; And even code and infrastructure that becomes _reliant_ on the fact that we're constantly re-executing functions in this way, because if there's one thing we know, it's that timing semantics _always_ eventually become part of your public API.

## Uno reverso

So the question becomes: How do we do the reverse? How do we make Hooks work more like Promises and other monads? Is that even possible? It turns out that it _is_, but it looks a bit different.

The important thing to realize is that in general, it is a _lot easier_ to make a program reactive if you can reduce it to, essentially, something that looks like a pure function. Given _this_ state, produce _that_ result. This is why React and other component-oriented frameworks have been so successful, you can have mirror the callstack, have it output a DOM tree, and it's pretty much 1-to-1. Incremental updates then involve rerunning a subtree in that original function, which, given we know it's pure, should be completely fine to replace.

But this strategy can also be applied to _any_ pure function. It doesn't need to be something that _produces_ a tree-like value - the callstack itself _is_ the tree.

```js {% visualize=true initialized=true showCode=false %}
const getCounter = reactive((ms) => {
  return relay(
    (state) => {
      const id = setInterval(() => state.value++, ms);

      return () => clearInterval(id);
    },
    { initValue: 0 },
  );
});

const divide = reactive((value, divideBy) => value / divideBy);

const floor = reactive((value) => Math.floor(value));

const quotient = reactive((value, divideBy) => floor(divide(value, divideBy)));

const getInnerWrapper = reactive(() => quotient(getCounter(3500).value, 3));

export const getOuterWrapper = reactive(() => getInnerWrapper());
```

In this example, we see a visualization of a real function callstack. The bars represent function calls, and the layers represent parent/child relationships, much like a flame chart. The definitions of those functions look like this:

```ts
const getCounter = reactive((ms) => {
  return relay(
    (state) => {
      const id = setInterval(() => state.value++, ms);

      return () => clearInterval(id);
    },
    { initValue: 0 },
  );
});

const divide = reactive((value, divideBy) => value / divideBy);

const floor = reactive((value) => Math.floor(value));

const quotient = reactive((value, divideBy) => floor(divide(value, divideBy)));

const getInnerWrapper = reactive(() => quotient(getCounter(3500).value, 3));

export const getOuterWrapper = reactive(() => getInnerWrapper());
```

You'll notice that whenever the counter increments, part of the stack lights up. Those are functions that are reactivating in response to mutable state updating - rerunning incrementally. If a function returns a different value, it continues propagating and its parent functions are also rerun. But if a function returns the _same_ value, then it stops propagation.

This allows us to efficiently, incrementally recompute _any function_. Not just rendering frameworks, but _any_ JavaScript in any context. And while I haven't formally proved it to myself yet, I think it's also guaranteed to rerun the _minimum_ number of functions that must be rerun to incrementally recompute.

This is what a reactive monad looks like.

Monads, once again, are a box that contains some context, and a way to turn that context into the _next thing_. With promises, that context is the program counter, the variables in scope, and so on.

With this monad, the context is:

1. The function,
2. The parameters it receives,
3. The mutable state it reads (if applicable), and
4. the parent functions that called that function.

When the parameters or the mutable state changes, we rerun the function. If _it_ changes, we rerun the parents, and continue propagating.

This is what Signalium provides: A way to annotate variables and functions in JavaScript to make them incrementally reactive.

## Some light prognostication

Toward the beginning of this (now far too long) essay, one thing I noted was that monads tend to lend themselves quite well to _syntax_. It seems that every time we figure out a new monadic structure, we're able to make use of it in the syntax of _some_ new language (probably Rust. I do love Rust.) So, what might that syntax look like in JavaScript?

```js
reactive async function fetchJson(url) {
  //...
}
```

This is purely speculative and to be 100% clear, this is _not_ part of the current direction of the Signals proposal. That proposal is about standardizing this primitive and its behavior, like the way Promises were added before `async`/`await`. And my current thought is that most likely, Signals could use _function decorators_ instead of some kind of keyword syntax - it would be more general, easier to add, and less to maintain.

```js
@reactive
async function fetchJson(url) {
  //...
}
```

What's neat (and validating) here though is how neatly _either option_ works for this abstraction. It fits _very nicely_ into syntax, and you could even imagine it interacting somehow with the `using` keyword from the [Explicit Resource Management Proposal](https://github.com/tc39/proposal-explicit-resource-management) in some way.
