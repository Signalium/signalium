export { hashValue, registerCustomHash } from './internals/utils/hash.js';

import { watcher } from './internals/core-api.js';
import { watchSignal, unwatchSignal } from './internals/watch.js';
import { getSignal } from './internals/get.js';
import { isReactivePromise, ReactivePromise } from './internals/async.js';
import { settled } from './internals/scheduling.js';
import type { ReactiveFnSignal } from './internals/reactive.js';
import { isPromise } from './internals/utils/type-utils.js';
import { ReactiveValue } from './types.js';

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
  const signal = watcher(fn) as ReactiveFnSignal<T, unknown[]>;

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
