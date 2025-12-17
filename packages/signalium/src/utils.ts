export { hashValue, registerCustomHash } from './internals/utils/hash.js';

import { watcher, reactive } from './internals/core-api.js';
import { watchSignal, unwatchSignal } from './internals/watch.js';
import { getSignal } from './internals/get.js';
import { isReactivePromise, ReactivePromiseImpl } from './internals/async.js';
import type { ReactiveSignal } from './internals/reactive.js';
import { isPromise } from './internals/utils/type-utils.js';
import { ReactiveValue, RelayState, DiscriminatedReactivePromise } from './types.js';

/**
 * Watches a function once in a reactive context, activating any relays,
 * then automatically tears down the watcher when complete.
 *
 * This is useful for testing or one-time reactive operations where you need
 * relays to be active but don't want the watcher to reschedule on updates.
 *
 * @param fn - A sync or async function to watch once
 * @returns A promise that resolves with the function's return value
 *
 * @example
 * ```ts
 * await watchOnce(async () => {
 *   const data = relay((state) => {
 *     // relay will be activated during watchOnce
 *     fetch('/api/data').then(res => state.value = res.data);
 *   });
 *   await data;
 *   return data.value;
 * });
 * ```
 */
export function watchOnce<T>(fn: () => T): T {
  // Create a watcher signal
  const signal = watcher(fn) as ReactiveSignal<T, unknown[]>;

  try {
    // Watch the signal to activate any relays
    watchSignal(signal);

    // Get the value, which runs the function
    let result = getSignal(signal);

    if (isReactivePromise(result as object) || isPromise(result as object)) {
      result = (result as Promise<T>).finally(() => {
        unwatchSignal(signal);
      }) as ReactiveValue<T>;
    } else {
      unwatchSignal(signal);
    }

    return result as T;
  } catch (error) {
    unwatchSignal(signal);
    throw error;
  }
}

export { setReactivePromise } from './internals/async.js';

/**
 * Forwards state from a source relay to the target relay's state.
 * This enables composition patterns where relays can add side effects
 * while transparently forwarding state from another relay.
 *
 * The forwarding is automatically tracked through the signal graph.
 * When the source relay updates, the target relay will re-run its
 * activation function, and forwardRelay will forward the new state.
 * No cleanup is needed - dependencies are managed automatically.
 *
 * @param state - The target relay's state object
 * @param sourceRelay - The source relay to forward state from
 *
 * @example
 * ```ts
 * const sourceRelay = relay(state => {
 *   // ... source relay logic
 * });
 *
 * const forwardedRelay = relay(state => {
 *   // Add additional side effect
 *   const cleanup = setupSomeEffect();
 *
 *   // Forward state from source relay (automatically tracked and cleaned up)
 *   forwardRelay(state, sourceRelay);
 *
 *   return cleanup; // Only return cleanup for the additional effect
 * });
 * ```
 */
export function forwardRelay<T>(state: RelayState<T>, sourceRelay: DiscriminatedReactivePromise<T>): void {
  // Verify that sourceRelay is actually a ReactivePromiseImpl
  if (!isReactivePromise(sourceRelay)) {
    throw new Error('forwardRelay: sourceRelay must be a ReactivePromise');
  }

  // Read from source relay to establish dependency and forward state
  // When sourceRelay updates, this relay's activation function will be called again,
  // and forwardRelay will be called again, forwarding the new state
  if (sourceRelay.isPending) {
    // For pending state, try to forward the promise if available
    // Accessing isPending establishes the dependency
    const source = sourceRelay as ReactivePromiseImpl<T>;
    const promise = source['_promise'] as Promise<T> | undefined;
    if (promise) {
      state.setPromise(promise);
    }
  } else if (sourceRelay.isRejected) {
    // Accessing error establishes dependency and forwards it
    const error = sourceRelay.error;
    if (error !== undefined) {
      state.setError(error);
    }
  } else if (sourceRelay.isResolved && sourceRelay.isReady) {
    // Accessing value establishes dependency and forwards it
    const value = sourceRelay.value;
    if (value !== undefined) {
      state.value = value;
    }
  }
}
