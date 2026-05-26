export {
  type Context,
  type Equals,
  type Notifier,
  type PendingReactivePromise,
  type ReactiveFn,
  type ReactiveOptions,
  type ReactiveTask,
  type ReactiveValue,
  type ReadyReactivePromise,
  type RelayActivate,
  type RelayHooks,
  type RelayState,
  type ReadonlySignal,
  type Signal,
  type SignalOptions,
  type Watcher,
} from './types.js';

export { reactive, reactiveMethod, reactiveSignal, task, relay, watcher, effect } from './internals/core-api.js';

export { signal, notifier, isSignal } from './internals/signal.js';

// Note: this re-export carries BOTH the value AND the type `ReactivePromise<T>`
// (the discriminated `Pending | Ready` union), because `internals/async.js`
// declares both under the same name. Mirrors the lib.es5.d.ts pattern where
// `Promise` is both the constructor value and the union type.
export { ReactivePromise } from './internals/async.js';

export { callback } from './internals/callback.js';

export { batch, flushSync, settled } from './internals/scheduling.js';

export {
  context,
  getContext,
  withContexts,
  setGlobalContexts,
  clearGlobalContexts,
  setScopeOwner,
  setRequestScopeGetter,
} from './internals/contexts.js';

export { watchOnce, forwardRelay } from './utils.js';
