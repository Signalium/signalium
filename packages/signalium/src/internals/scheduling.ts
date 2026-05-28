import { scheduleFlush as _scheduleFlush, runBatch } from './config.js';
import { ReactiveSignal } from './reactive.js';
import { checkAndRunListeners, checkSignal } from './get.js';
import { runListeners as runDerivedListeners } from './reactive.js';
import type { Tracer } from './trace.js';
import { deactivateSignal } from './watch.js';
import { Effect, checkAndRunEffect } from './effect.js';

type PullNode = ReactiveSignal<any, any> | Effect;

let PENDING_PULLS_HEAD: PullNode | undefined = undefined;
let PENDING_PULLS_TAIL: PullNode | undefined = undefined;
let PENDING_ASYNC_PULLS: ReactiveSignal<any, any>[] = [];
let PENDING_DEACTIVE = new Set<ReactiveSignal<any, any>>();
let PENDING_LISTENERS: (ReactiveSignal<any, any>)[] = [];
let PENDING_TRACERS: Tracer[] | undefined = IS_DEV ? [] : undefined;

const microtask = () => Promise.resolve();

let currentFlush: { promise: Promise<void>; resolve: () => void } | null = null;
// Re-entrancy guard for flushSync. If a listener (running inside flushSync's
// listener phase) directly calls flushSync, we early-return — the outer call
// will pick up newly added pulls in its next drain iteration if it's still in
// the drain loop, otherwise they fall through to the existing setTimeout path.
let inFlushSync = false;
let batchDepth = 0;

const scheduleFlush = (fn: () => void) => {
  if (currentFlush) return;

  let resolve: () => void;
  const promise = new Promise<void>(r => (resolve = r));

  currentFlush = { promise, resolve: resolve! };

  _scheduleFlush(flushWatchers);
};

export const schedulePull = (signal: PullNode) => {
  if (!signal._isPullQueued) {
    signal._isPullQueued = true;
    signal.nextPull = undefined;
    signal.prevPull = PENDING_PULLS_TAIL;

    if (PENDING_PULLS_TAIL === undefined) {
      PENDING_PULLS_HEAD = signal;
    } else {
      PENDING_PULLS_TAIL.nextPull = signal;
    }

    PENDING_PULLS_TAIL = signal;
  }

  if (batchDepth > 0) {
    return;
  }
  scheduleFlush(flushWatchers);
};

export const cancelPull = (signal: PullNode) => {
  if (!signal._isPullQueued) return;

  const next = signal.nextPull;
  const prev = signal.prevPull;

  if (PENDING_PULLS_HEAD === signal) {
    PENDING_PULLS_HEAD = next;
  }

  if (PENDING_PULLS_TAIL === signal) {
    PENDING_PULLS_TAIL = prev;
  }

  if (prev !== undefined) {
    prev.nextPull = next;
  }

  if (next !== undefined) {
    next.prevPull = prev;
  }

  signal.nextPull = undefined;
  signal.prevPull = undefined;
  signal._isPullQueued = false;
};

export const scheduleAsyncPull = (signal: ReactiveSignal<any, any>) => {
  PENDING_ASYNC_PULLS.push(signal);
  scheduleFlush(flushWatchers);
};

export const scheduleDeactivate = (signal: ReactiveSignal<any, any>) => {
  PENDING_DEACTIVE.add(signal);
  scheduleFlush(flushWatchers);
};

export const cancelDeactivate = (signal: ReactiveSignal<any, any>) => {
  PENDING_DEACTIVE.delete(signal);
};

export const scheduleListeners = (signal: ReactiveSignal<any, any>) => {
  PENDING_LISTENERS.push(signal);
  if (inFlushSync) {
    return;
  }
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
  while (PENDING_ASYNC_PULLS.length > 0 || PENDING_PULLS_HEAD !== undefined) {
    const asyncPulls = PENDING_ASYNC_PULLS;

    PENDING_ASYNC_PULLS = [];

    for (const pull of asyncPulls) {
      checkSignal(pull);
    }

    let pull: PullNode | undefined = PENDING_PULLS_HEAD;
    PENDING_PULLS_HEAD = undefined;
    PENDING_PULLS_TAIL = undefined;

    while (pull !== undefined) {
      const next: PullNode | undefined = pull.nextPull;
      pull.nextPull = undefined;
      pull.prevPull = undefined;
      pull._isPullQueued = false;
      if (pull instanceof Effect) {
        checkAndRunEffect(pull);
      } else {
        checkAndRunListeners(pull);
      }
      pull = next;
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
    for (const signal of PENDING_DEACTIVE) {
      deactivateSignal(signal);
    }

    PENDING_DEACTIVE.clear();

    for (const signal of PENDING_LISTENERS) {
      runDerivedListeners(signal as any);
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

// Synchronous flush: drains PENDING_PULLS and runs the listener/deactivation
// tail without yielding to a microtask. Does NOT process PENDING_ASYNC_PULLS
// (those need the microtask-yield contract for relay/async-task resolution
// ordering, and remain handled by the existing setTimeout-driven flushWatchers
// path). Does NOT touch `currentFlush` — async pulls scheduled during the
// drain still get their setTimeout pickup via scheduleFlush as before.
//
// This is the workhorse that `batch()` uses to provide synchronous flush
// semantics with zero per-call Promise allocation. Pre-existing `currentFlush`
// (if any) and its queued setTimeout are left intact; when that timer fires
// and finds the queues drained, flushWatchers becomes a cheap no-op.
export const flushSync = () => {
  if (inFlushSync) {
    return;
  }

  inFlushSync = true;
  try {
    while (PENDING_PULLS_HEAD !== undefined) {
      let pull: PullNode | undefined = PENDING_PULLS_HEAD;
      PENDING_PULLS_HEAD = undefined;
      PENDING_PULLS_TAIL = undefined;

      while (pull !== undefined) {
        const next: PullNode | undefined = pull.nextPull;
        pull.nextPull = undefined;
        pull.prevPull = undefined;
        pull._isPullQueued = false;
        if (pull instanceof Effect) {
          checkAndRunEffect(pull);
        } else {
          checkAndRunListeners(pull);
        }
        pull = next;
      }
    }

    if (PENDING_DEACTIVE.size > 0 || PENDING_LISTENERS.length > 0 || (IS_DEV && PENDING_TRACERS!.length > 0)) {
      runBatch(() => {
        for (const signal of PENDING_DEACTIVE) {
          deactivateSignal(signal);
        }

        PENDING_DEACTIVE.clear();

        for (const signal of PENDING_LISTENERS) {
          runDerivedListeners(signal as any);
        }

        if (IS_DEV) {
          for (const tracer of PENDING_TRACERS!) {
            tracer.flush();
          }
          PENDING_TRACERS = [];
        }

        PENDING_LISTENERS = [];
      });
    }
  } finally {
    inFlushSync = false;
  }
};

export const batch = (fn: () => void) => {
  batchDepth++;
  let didThrow = true;
  try {
    fn();
    didThrow = false;
  } finally {
    batchDepth--;
    if (!didThrow && batchDepth === 0) {
      flushSync();
    }
  }
};
