# Signalium Transforms — Babel preset

The `signalium/transform` entry point exports a Babel preset (`signaliumPreset`) that applies three transforms. These are essential for the async reactive programming model — they run at build time and in tests.

Source: `packages/signalium/src/transform/`

## The three transforms

### 1. Async transform (`async.ts`)

Rewrites `async` functions passed to `reactive()`, `relay()`, `task()`, `watcher()`, etc. into generator functions. This allows the reactive runtime to pause/resume execution at `await` points, inserting promise-edge dependencies into the reactive graph.

**Before:**
```js
const data = reactive(async (id) => {
  const user = await fetchUser(id);
  return user.name;
});
```

**After (conceptual):**
```js
const data = reactive(function*(id) {
  const user = yield fetchUser(id);
  return user.name;
});
```

The runtime's `generatorResultToPromiseWithConsumer` handles the generator protocol.

### 2. Callback transform (`callback.ts`)

Wraps function arguments (callbacks) passed to reactive functions with `callback()` from signalium, so that callbacks executed later can still track their reactive context.

Applies to functions passed as arguments to `reactive()`, `reactiveMethod()`, `relay()`, `task()`, `component()`.

### 3. Promise methods transform (`promise.ts`)

Replaces `Promise.all()`, `Promise.race()`, `Promise.any()`, `Promise.allSettled()` with their `ReactivePromise` equivalents inside reactive functions.

## Configuration

```ts
signaliumPreset({
  // Additional imports to treat as reactive (besides the defaults from 'signalium')
  transformedImports: [
    ['reactive', /instrumented-hooks.js$/],  // treat test wrapper as reactive too
    ['task', /instrumented-hooks.js$/],
  ],
  importPaths: ['signalium'],  // additional import paths to scan
  callbackImportPath: 'signalium',  // where to import `callback` from
  promiseImportPath: 'signalium',   // where to import `ReactivePromise` from
})
```

The `transformedImports` option is heavily used in test configs (`vitest.config.ts`) to ensure the instrumented test hooks from `utils/instrumented-hooks.ts` also get transformed.

## Tests

Transform-specific tests live in `packages/signalium/src/transform/__tests__/`. Run with:
```sh
npm run test:transform  # from packages/signalium
```

## Key implementation detail

Each transform uses `createTransformedImports()` from `utils.ts` to build a `Map<importedName, (string | RegExp)[]>` that matches import declarations. The transform then checks whether a function's callee is a tracked import before applying the transformation.
