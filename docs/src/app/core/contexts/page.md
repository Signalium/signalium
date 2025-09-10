---
title: Contexts
nextjs:
  metadata:
    title: Contexts
    description: Understanding Contexts in Signalium
---

Contexts are a mainstay not just of React, but of most major frameworks these days. They make a lot of sense in the world of components and DOM - provide some value for all of the children in this part of the tree. It falls naturally out of the tree-oriented data structure backing everything.

Signalium includes Contexts as well. A basic example looks like:

```js
import { reactive, context, getContext, withContexts } from 'signalium';

const ApiPrefixContext = context('/api/');

const getUsersUrl = reactive(() => {
  const prefix = getContext(ApiPrefixContext);

  return `${prefix}users`;
});

// '/api/users'
const usersUrl = getUsersUrl();

// '/api-v2/users'
const usersV2Url = withContexts([[ApiPrefixContext, '/api-v2/']], () => {
  return getUsersUrl();
});
```

However, Signalium is also designed to work in many places _without_ the DOM - it can be used on the server, in background tasks and webworkers, in Node apps, and so on. Really, it can be used anywhere that you can use _plain JavaScript functions_, just making them reactive instead of a single function call.

So, how do we think of these values if we're thinking beyond the DOM tree?

## Contexts as implicit parameters

Just like the DOM, function execution forms a tree, where each function call is a node and its children are the functions that _it_ calls, e.g. the callstack tree.

In this mental model, Contexts can be thought of as _implicit parameters_ that are in scope for all functions below a certain part of the call stack tree. These are essentially like [contextual parameters in Scala](https://docs.scala-lang.org/tour/implicit-parameters.html) and similar functional languages.

Going all the way back to [signal-purity](/core/signals-and-reactive-functions#signal-purity), we said that given the same parameters and the same Signal state, a signal-pure function is guaranteed to return the same result. In this model, Contexts are simply _extra parameters_ that are accessed lazily, so our statement still holds. If we run a Signal in two different Contexts, the results _could_ be different. But if the Context is the same, then the value will be the same and we can reuse the result between function calls.

Signalium manages this under the hood, forking Reactive Functions if new Contexts are set.

```js
import { context, withContexts, reactive } from 'signalium';

const LogContext = context('root');

const log = reactive(() => {
  console.log(getContext(LogContext));
});

log(); // logs 'root'
log(); // does not log

withContexts([[LogContext, 'child']], () => {
  log(); // logs 'child'
  log(); // does not log
});
```

All contexts are collectively treated like a single parameter in terms of forking. So if you use `withContexts` with any context, all reactives used within that context will rerun. Most contexts are used at the top level of an application for dependency injection, so this generally is not an issue, but if you do use a child context dynamically in the callstack, you should be aware that it could cause Reactive Functions to rerun even if they do not _use_ the overridden child context.

## Contexts and mutable state

Contexts themselves are considered _immutable_. Like parameters, when you call a Reactive Function with a different context value, it will always create a new instance of that Reactive Function and call its function again. If you want to update a context, you can set it as a _Signal_ within the context.

```js
import { context, withContexts, reactive, signal } from 'signalium';

const apiPrefix = signal('/');
const ApiPrefixContext = context(apiPrefix);

const getUsersUrl = reactive(() => {
  const prefix = useContext(ApiPrefixContext).value;

  return `${prefix}users`;
});

// '/api/users'
const usersUrl = getUsersUrl();

apiPrefix.value = '/api-v2/';

// '/api-v2/users'
const usersUrlV2 = getUsersUrl();
```

## Summary

With all of that in mind, let's summarize what we've learned:

- Contexts
  - Created with `context`
  - Accessed with `getContext`
  - Set with `withContexts`

And that's all there is to know about contexts. Contexts are invaluable for accessing semi-global state, such as an api or database client, so while they are not _technically_ a core part of the _Signals_ powering Signalium, they are a crucial component for writing Signal-based apps ergonomically, and that's why they're included.
