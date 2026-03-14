# Signalium

Reactive signals library with first-class async support and a React integration layer. Monorepo with two packages plus a docs site.

## Repository structure

```
packages/
  signalium/          Core signals library (the main package)
  fetchium/            Data-fetching / query layer built on signalium
docs/                 Documentation site (out of scope for typical work)
```

Package manager: **npm** workspaces. Task runner: **turbo**.

## Commands

```sh
# From repo root
npm run test              # all tests via turbo
npm run build             # all packages via turbo
npm run check-types       # tsc --noEmit for all packages
npm run lint              # eslint + prettier

# From packages/signalium
npm test                  # all vitest projects (unit + transform + react)
npm run test:unit         # non-React tests only (node env, fast)
npm run test:react        # browser tests (Playwright via @vitest/browser)
npm run dev:unit          # watch mode for unit tests
npm run check-types       # tsc --noEmit

# From packages/fetchium
npm test                  # unit + react tests
npm run test:unit
npm run test:react
```

React tests run in a **real browser** (Playwright/Chromium, headless). Unit tests run in Node. Both use vitest.

## Performance-sensitive code

This is a performance-critical library. Follow these guidelines:

- **Prefer class instances over plain objects or arrays** — they have better hidden class optimization in V8.
- **Respect object shaping** — once a class instance is created, do not add or remove properties dynamically. All properties must be declared in the constructor or as class fields so V8 assigns a stable hidden class.
- **Minimize object allocations** — reuse objects where possible, avoid creating temporary objects in hot paths (e.g. inside `runSignal`, `checkSignal`, `dirtySignal`).
- **Bitwise flags over booleans** — `ReactiveSignal.flags` packs state + boolean properties into a single number using `ReactiveFnFlags`. Follow this pattern.

## Global compile-time constant

`IS_DEV` is a global boolean replaced at build time:

- In tests and dev builds: `true`
- In production builds: `false`, all `if (IS_DEV)` blocks are tree-shaken

Declared in `packages/signalium/src/globals.d.ts`. Do NOT import it — it's a bare global.

---

## Package: signalium

### Entry points

| Import path           | Source                   |
| --------------------- | ------------------------ |
| `signalium`           | `src/index.ts`           |
| `signalium/react`     | `src/react/index.ts`     |
| `signalium/config`    | `src/config.ts`          |
| `signalium/utils`     | `src/utils.ts`           |
| `signalium/debug`     | `src/debug.ts`           |
| `signalium/transform` | `src/transform/index.ts` |

In tests, vitest aliases resolve bare `signalium` and `signalium/*` imports directly to the source `.ts` files (see `vitest.config.ts`).

### Core internals (`src/internals/`)

The reactive graph engine. Key files:

| File              | Purpose                                                                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `reactive.ts`     | `ReactiveSignal` class (the computed/derived signal), `ReactiveDefinition`, `ListenerMeta`, `createReactiveSignal`, `createReactiveDefinition` |
| `signal.ts`       | `StateSignal` class (mutable state signal), `notifier()`                                                                                       |
| `async.ts`        | `ReactivePromiseImpl` (async signals), `createRelay`, `createTask`, `createPromise`                                                            |
| `get.ts`          | `getSignal` (reads a signal, establishes dependencies), `checkSignal` (validates dirty state), `runSignal` (recomputes)                        |
| `dirty.ts`        | Dirty propagation: `dirtySignal`, `propagateDirty`                                                                                             |
| `watch.ts`        | Watch/unwatch lifecycle: `watchSignal`, `unwatchSignal`, `activateSignal`, `deactivateSignal`, relay activation                                |
| `scheduling.ts`   | Flush system: `schedulePull`, `scheduleFlush`, `flushWatchers`, `settled()`                                                                    |
| `edge.ts`         | Dependency edges between signals (`Edge`, `PromiseEdge`)                                                                                       |
| `consumer.ts`     | Thread-local `CURRENT_CONSUMER` tracking for automatic dependency registration                                                                 |
| `contexts.ts`     | `SignalScope` (DI-like context system), `context()`, `getContext()`                                                                            |
| `consume-deep.ts` | `CONSUME_DEEP` protocol for deep dependency tracking across the React boundary                                                                 |
| `core-api.ts`     | Public API wrappers: `reactive()`, `reactiveMethod()`, `reactiveSignal()`, `relay()`, `task()`, `watcher()`                                    |
| `callback.ts`     | `callback()` for wrapping imperative callbacks in a reactive context                                                                           |
| `config.ts`       | `setConfig()` for scheduler/batch customization                                                                                                |

### Signal lifecycle

1. `ReactiveSignal` starts in `Dirty` state
2. First read via `getSignal()` triggers `checkSignal()` -> `runSignal()`
3. `runSignal()` sets `CURRENT_CONSUMER`, runs the compute function; any signals read during compute become dependencies via `getSignal()` -> edge creation
4. When a `StateSignal` is set, `notify()` calls `dirtySignal()` on all subscriber `ReactiveSignal`s
5. Dirty propagation marks signals as `MaybeDirty` and inserts edges into the `dirtyHead` linked list
6. `checkSignal()` walks `dirtyHead` to verify whether dependencies actually changed before recomputing

### Watched signals & React

When a signal has external listeners (React components, watchers):

- `addListenerLazy()` eagerly watches the signal (activates relays in the dep tree)
- The scheduling system flushes watched signals: `checkAndRunListeners()` -> fires listener callbacks
- `useSyncExternalStore` subscribes via the listener system

### React integration (`src/react/`)

| File                         | Purpose                                                             |
| ---------------------------- | ------------------------------------------------------------------- |
| `use-reactive.ts`            | `useReactive()` — main hook bridging signals to React               |
| `component.tsx`              | `component()` — wraps a function component in a lazy ReactiveSignal |
| `context.ts`                 | `ScopeContext`, `useScope()`, `useContext()`                        |
| `provider.tsx`               | `ContextProvider` component                                         |
| `use-signal.ts`              | `useSignal()` — creates a StateSignal scoped to a component         |
| `suspend-signals-context.ts` | Suspended signals context for loading states                        |

`useReactive` has three code paths (function, StateSignal, direct ReactivePromise), each calling the same hook pattern: one `useSyncExternalStore` for primary subscription + one for deep dependency tracking via `CONSUME_DEEP`.

### Test patterns

- **Unit tests** (`src/__tests__/`): Use instrumented hooks from `utils/instrumented-hooks.ts` which wrap `reactive()`, `relay()`, `task()` with call counters. Use `watcher()` + `addListener()` to watch signals, `settled()` or `nextTick()` to flush.
- **React tests** (`src/react/__tests__/`): Use `vitest-browser-react`'s `render()`, `expect.element()`, `createRenderCounter()` for tracking render counts. These run in a real Chromium browser.
- The signalium Babel preset is applied to tests via `vitest.config.ts` so async transforms work in test code.

### Transform (Babel preset) — `src/transform/`

A Babel preset (`signaliumPreset`) that provides three transforms:

1. **Async transform** — rewrites `async` functions used with `reactive()` to use generators, enabling pause/resume semantics
2. **Callback transform** — wraps callback arguments in `callback()` for reactive tracking
3. **Promise methods transform** — replaces `Promise.all`/`race`/etc. with `ReactivePromise` equivalents

See `SIGNALIUM_TRANSFORMS.md` for details when working on transforms.

---

## Package: fetchium

Data-fetching layer built on signalium's reactive primitives. Provides `Query`, `Entity`, `Mutation`, and a type DSL (`t`).

See `QUERIUS.md` for detailed architecture when working in this package.

Key concepts at a glance:

- **Query** — class-based query definitions with path, params, response shape. Uses `relay()` internally.
- **Entity** — normalized entity cache with identity-stable Proxy objects. Entity proxies consume a `Notifier` on property access for reactive tracking.
- **QueryClient** — manages query instances, entity store, cache, network/refetch/eviction managers.
- **`t` type DSL** — `t.string`, `t.entity(User)`, `t.array(...)`, etc. for defining response shapes. During `reifyShape()`, computes `subEntityPaths` for fast entity traversal.
- **`useQuery()`** — React hook, delegates to `useReactive(getQuery, ...)`. Deep entity tracking handled by `CONSUME_DEEP` protocol.
