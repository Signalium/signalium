import { scheduleFlush as _scheduleFlush, runBatch } from '../config.js';
import { DerivedSignal } from './derived.js';
import { checkAndRunListeners, checkSignal } from './get.js';
import { runListeners as runDerivedListeners } from './derived.js';
import { runListeners as runStateListeners } from './state.js';
import { Tracer } from '../trace.js';
import { unwatchSignal } from './connect.js';
import { StateSignal } from './state.js';
import { ROOT_SCOPE, SignalScope } from './contexts.js';

// Determine once at startup which scheduling function to use for GC
const scheduleIdleCallback =
  typeof requestIdleCallback === 'function' ? requestIdleCallback : (cb: () => void) => _scheduleFlush(cb);

let PROMISE_WAS_RESOLVED = false;

let PENDING_PULLS: DerivedSignal<any, any>[] = [];
let PENDING_ASYNC_PULLS: DerivedSignal<any, any>[] = [];
let PENDING_UNWATCH = new Map<DerivedSignal<any, any>, number>();
let PENDING_LISTENERS: (DerivedSignal<any, any> | StateSignal<any>)[] = [];
let PENDING_TRACERS: Tracer[] = [];
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

export const setResolved = () => {
  PROMISE_WAS_RESOLVED = true;
};

export const schedulePull = (signal: DerivedSignal<any, any>) => {
  PENDING_PULLS.push(signal);
  scheduleFlush(flushWatchers);
};

export const scheduleAsyncPull = (signal: DerivedSignal<any, any>) => {
  PENDING_ASYNC_PULLS.push(signal);
  scheduleFlush(flushWatchers);
};

export const scheduleUnwatch = (unwatch: DerivedSignal<any, any>) => {
  const current = PENDING_UNWATCH.get(unwatch) ?? 0;

  PENDING_UNWATCH.set(unwatch, current + 1);

  scheduleFlush(flushWatchers);
};

export const scheduleListeners = (signal: DerivedSignal<any, any> | StateSignal<any>) => {
  PENDING_LISTENERS.push(signal);
  scheduleFlush(flushWatchers);
};

export const scheduleTracer = (tracer: Tracer) => {
  PENDING_TRACERS.push(tracer);
  scheduleFlush(flushWatchers);
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
  while (PROMISE_WAS_RESOLVED || PENDING_ASYNC_PULLS.length > 0 || PENDING_PULLS.length > 0) {
    PROMISE_WAS_RESOLVED = false;
    const asyncPulls = PENDING_ASYNC_PULLS;

    PENDING_ASYNC_PULLS = [];

    for (const pull of asyncPulls) {
      checkSignal(pull);
    }

    const pulls = PENDING_PULLS;

    PENDING_PULLS = [];

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
      if (signal instanceof DerivedSignal) {
        runDerivedListeners(signal as any);
      } else {
        runStateListeners(signal as any);
      }
    }

    for (const tracer of PENDING_TRACERS) {
      tracer.flush();
    }

    PENDING_UNWATCH.clear();
    PENDING_LISTENERS = [];
    PENDING_TRACERS = [];
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
  // flushDisconnects();
};
