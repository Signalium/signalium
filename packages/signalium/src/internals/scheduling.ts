import { scheduleFlush as _scheduleFlush, runBatch } from './config.js';
import { ReactiveSignal } from './reactive.js';
import { checkAndRunListeners, checkSignal } from './get.js';
import { runListeners as runDerivedListeners } from './reactive.js';
import { runListeners as runStateListeners } from './signal.js';
import type { Tracer } from './trace.js';
import { unwatchSignal } from './watch.js';
import { StateSignal } from './signal.js';
import { SignalScope } from './contexts.js';

// Determine once at startup which scheduling function to use for GC
const scheduleIdleCallback =
  typeof requestIdleCallback === 'function' ? requestIdleCallback : (cb: () => void) => _scheduleFlush(cb);

let PENDING_PULLS: Set<ReactiveSignal<any, any>> = new Set();
let PENDING_ASYNC_PULLS: ReactiveSignal<any, any>[] = [];
let PENDING_UNWATCH = new Map<ReactiveSignal<any, any>, number>();
let PENDING_LISTENERS: (ReactiveSignal<any, any> | StateSignal<any>)[] = [];
let PENDING_TRACERS: Tracer[] | undefined = IS_DEV ? [] : undefined;
let PENDING_GC = new Set<SignalScope>();

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

export const scheduleUnwatch = (unwatch: ReactiveSignal<any, any>) => {
  const current = PENDING_UNWATCH.get(unwatch) ?? 0;

  PENDING_UNWATCH.set(unwatch, current + 1);

  scheduleFlush(flushWatchers);
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

export const scheduleGcSweep = (scope: SignalScope) => {
  PENDING_GC.add(scope);

  if (PENDING_GC.size > 1) return;

  scheduleIdleCallback(() => {
    for (const scope of PENDING_GC) {
      scope.sweepGc();
    }

    PENDING_GC.clear();
  });
};

const flushWatchers = async () => {
  const flush = currentFlush!;

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
    for (const [signal, count] of PENDING_UNWATCH) {
      unwatchSignal(signal, count);
    }

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

    PENDING_UNWATCH.clear();
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

export const batch = (fn: () => void) => {
  let resolve: () => void;
  const promise = new Promise<void>(r => (resolve = r));

  currentFlush = { promise, resolve: resolve! };

  fn();
  flushWatchers();
};
