import { useEffect, useLayoutEffect, useReducer, useRef } from 'react';
import type { ReactiveSignal } from '../internals/reactive.js';
import { getReactDelivery, runBatch, scheduleReactDelivery, type ReactDelivery } from '../internals/config.js';

export type { ReactDelivery };

/** Per-call options accepted by `component()`, `useReactive` and `useReactiveShallow`. */
export interface ReactReaderOptions {
  /**
   * How this reader learns about changes; overrides `setConfig({ reactDelivery })`. Use `'sync'`
   * for readers whose values must stay correlated with other readers in every commit, and
   * `'state'` for live-data leaves that should not hold up transitions. See {@link ReactDelivery}.
   */
  delivery?: ReactDelivery;
}

/**
 * Resolves a reader's delivery mode once per mounted instance. The mode decides which hooks the
 * reader calls, so it must not change for the lifetime of the instance; a global config change
 * applies to readers that mount afterwards.
 */
export function useDeliveryMode(override: ReactDelivery | undefined): ReactDelivery {
  const ref = useRef<ReactDelivery | undefined>(undefined);
  return (ref.current ??= override ?? getReactDelivery());
}

// Layout effects subscribe as close to the commit as possible. On the server neither effect runs;
// the plain `useEffect` keeps older React versions from warning about `useLayoutEffect` in SSR.
const useCommitEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

const increment = (n: number) => n + 1;

/**
 * State-delivery bookkeeping for one mounted reader. `committed` is the signal version (its
 * `updatedCount`) the last commit rendered; a notification only turns into a `setState` when the
 * signal has moved past it.
 */
class StateDelivery {
  signal: ReactiveSignal<any, any>;
  committed: number;
  forceUpdate: () => void;
  /** In the pending-delivery queue. */
  queued = false;
  /** A `setState` was delivered and its render has not committed yet. */
  awaitingCommit = false;
  /** Subscribed (between the subscription effect's setup and cleanup). */
  mounted = false;
  listener: () => void;

  constructor(signal: ReactiveSignal<any, any>, version: number, forceUpdate: () => void) {
    this.signal = signal;
    this.committed = version;
    this.forceUpdate = forceUpdate;
    this.listener = () => this.check();
  }

  check() {
    if (this.queued || this.awaitingCommit || !this.mounted) return;

    if (this.signal.updatedCount !== this.committed) {
      enqueueDelivery(this);
    }
  }
}

let PENDING_DELIVERIES: StateDelivery[] = [];
let deliveryScheduled = false;

function enqueueDelivery(delivery: StateDelivery) {
  delivery.queued = true;
  PENDING_DELIVERIES.push(delivery);

  if (!deliveryScheduled) {
    deliveryScheduled = true;
    scheduleReactDelivery(flushDeliveries);
  }
}

function flushDeliveries() {
  deliveryScheduled = false;

  const deliveries = PENDING_DELIVERIES;
  PENDING_DELIVERIES = [];

  runBatch(() => {
    for (const delivery of deliveries) {
      delivery.queued = false;

      // Re-check: the reader may have unmounted, or re-rendered for another reason and already
      // committed the latest version, since it was queued.
      if (delivery.mounted && delivery.signal.updatedCount !== delivery.committed) {
        delivery.awaitingCommit = true;
        delivery.forceUpdate();
      }
    }
  });
}

/**
 * Drives a reader with `setState` instead of `useSyncExternalStore` (`delivery: 'state'`).
 *
 * The render reads the signal directly (so a render that happens for any other reason sees fresh
 * data) and passes the version it rendered. On commit the reader subscribes, claiming the render
 * lease that `subscribe` (the signal's `addListenerLazy` result) represents, and compares the
 * version it rendered with the signal's current one, so a change that landed between render and
 * subscribe is never lost. Notifications are coalesced per reader and flushed together, in one
 * `runBatch`, on `scheduleReactDelivery`. The `setState` runs outside any transition, at React's
 * default priority, which waits for an in-progress transition rather than restarting it.
 */
export function useStateDelivery(
  signal: ReactiveSignal<any, any>,
  subscribe: (listener: () => void) => () => void,
  version: number,
): void {
  const [, forceUpdate] = useReducer(increment, 0);
  const ref = useRef<StateDelivery | null>(null);
  const delivery = (ref.current ??= new StateDelivery(signal, version, forceUpdate));

  // Every commit records what it rendered, then re-checks: a change that arrived while a delivered
  // update was rendering (and was therefore not queued again) is picked up here.
  useCommitEffect(() => {
    delivery.signal = signal;
    delivery.committed = version;
    delivery.awaitingCommit = false;
    delivery.check();
  });

  useCommitEffect(() => {
    delivery.mounted = true;
    const unsubscribe = subscribe(delivery.listener);

    // Catch a change between this render and the subscription.
    delivery.check();

    return () => {
      delivery.mounted = false;
      unsubscribe();
    };
  }, [subscribe]);
}
