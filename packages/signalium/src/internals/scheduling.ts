import { scheduleFlush as _scheduleFlush, runBatch } from './config.js';
import { ReactiveSignal } from './reactive.js';
import type { DeactivateOptions } from '../types.js';
import { checkAndRunListeners, checkSignal } from './get.js';
import { runListeners as runDerivedListeners } from './reactive.js';
import { runListeners as runStateListeners } from './signal.js';
import type { Tracer } from './trace.js';
import { deactivateSignal } from './watch.js';
import { StateSignal } from './signal.js';

let PENDING_PULLS: Set<ReactiveSignal<any, any>> = new Set();
let PENDING_ASYNC_PULLS: ReactiveSignal<any, any>[] = [];
// Maps each pending signal to its deactivation context (pause vs cleanup).
// Clean wins on conflict.
let PENDING_DEACTIVE = new Map<ReactiveSignal<any, any>, DeactivateOptions>();
let PENDING_LISTENERS: (ReactiveSignal<any, any> | StateSignal<any>)[] = [];
let PENDING_TRACERS: Tracer[] | undefined = IS_DEV ? [] : undefined;

const microtask = () => Promise.resolve();

let currentFlush: { promise: Promise<void>; resolve: () => void } | null = null;

const scheduleFlush = (fn: () => void) => {
  if (currentFlush) return;

  let resolve: () => void;
  const promise = new Promise<void>(r => (resolve = r));

  currentFlush = { promise, resolve: resolve! };

  _scheduleFlush(flushWatchers);
};

export const schedulePull = (signal: ReactiveSignal<any, any>) => {
  PENDING_PULLS.add(signal);
  scheduleFlush(flushWatchers);
};

export const cancelPull = (signal: ReactiveSignal<any, any>) => {
  PENDING_PULLS.delete(signal);
};

export const scheduleAsyncPull = (signal: ReactiveSignal<any, any>) => {
  PENDING_ASYNC_PULLS.push(signal);
  scheduleFlush(flushWatchers);
};

export const scheduleDeactivate = (signal: ReactiveSignal<any, any>, options: DeactivateOptions = {}) => {
  const existing = PENDING_DEACTIVE.get(signal);
  // A genuine cleanup must never be downgraded to a pause: if this signal was
  // already scheduled as a clean, keep it a clean.
  PENDING_DEACTIVE.set(
    signal,
    existing === undefined ? options : { isPausing: Boolean(existing.isPausing && options.isPausing) },
  );
  scheduleFlush(flushWatchers);
};

export const cancelDeactivate = (signal: ReactiveSignal<any, any>) => {
  PENDING_DEACTIVE.delete(signal);
};

export const scheduleListeners = (signal: ReactiveSignal<any, any> | StateSignal<any>) => {
  PENDING_LISTENERS.push(signal);
  scheduleFlush(flushWatchers);
};

export const scheduleTracer = (tracer: Tracer) => {
  if (IS_DEV) {
    PENDING_TRACERS!.push(tracer);
    scheduleFlush(flushWatchers);
  }
};

const flushWatchers = async () => {
  const flush = currentFlush;

  if (!flush) return;

  // Flush all auto-pulled signals recursively, clearing
  // the microtask queue until they are all settled
  while (PENDING_ASYNC_PULLS.length > 0 || PENDING_PULLS.size > 0) {
    const asyncPulls = PENDING_ASYNC_PULLS;

    PENDING_ASYNC_PULLS = [];

    for (const pull of asyncPulls) {
      checkSignal(pull);
    }

    const pulls = PENDING_PULLS;

    PENDING_PULLS = new Set();

    for (const pull of pulls) {
      checkAndRunListeners(pull);
    }

    // This is used to tell the scheduler to wait if any async values have been resolved
    // since the last tick. If they have, we wait an extra microtask to ensure that the
    // async values have recursivey flushed before moving on to pulling watchers.

    await microtask();
  }

  // Clear the flush so that if any more watchers are scheduled,
  // they will be flushed in the next tick
  currentFlush = null;

  runBatch(() => {
    for (const [signal, options] of PENDING_DEACTIVE) {
      deactivateSignal(signal, options);
    }

    PENDING_DEACTIVE.clear();

    for (const signal of PENDING_LISTENERS) {
      if (signal instanceof ReactiveSignal) {
        runDerivedListeners(signal as any);
      } else {
        runStateListeners(signal as any);
      }
    }

    if (IS_DEV) {
      for (const tracer of PENDING_TRACERS!) {
        tracer.flush();
      }
      PENDING_TRACERS = [];
    }

    PENDING_LISTENERS = [];
  });

  // resolve the flush promise
  flush.resolve();
};

export const settled = async () => {
  while (currentFlush) {
    await currentFlush.promise;
  }
};

let _pendingAsyncCount = 0;
let _pendingAsyncResolvers: (() => void)[] = [];

export const trackPendingStart = () => {
  _pendingAsyncCount++;
};

export const trackPendingEnd = () => {
  _pendingAsyncCount--;
  if (_pendingAsyncCount === 0) {
    const resolvers = _pendingAsyncResolvers;
    _pendingAsyncResolvers = [];
    for (const resolve of resolvers) resolve();
  }
};

export const asyncSettled = async (timeout = 100) => {
  const deadline = Date.now() + timeout;

  while (true) {
    await settled();
    if (_pendingAsyncCount === 0) break;

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error(
        `asyncSettled timed out: ${_pendingAsyncCount} reactive promises still pending after ${timeout}ms`,
      );
    }

    await Promise.race([
      new Promise<void>(resolve => _pendingAsyncResolvers.push(resolve)),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `asyncSettled timed out: ${_pendingAsyncCount} reactive promises still pending after ${timeout}ms`,
              ),
            ),
          remaining,
        ),
      ),
    ]);
  }
};

export const batch = (fn: () => void) => {
  const prevFlush = currentFlush;

  let resolve: () => void;
  const promise = new Promise<void>(r => (resolve = r));

  currentFlush = { promise, resolve: resolve! };

  fn();
  flushWatchers();

  if (prevFlush) {
    promise.then(prevFlush.resolve);
  }
};
