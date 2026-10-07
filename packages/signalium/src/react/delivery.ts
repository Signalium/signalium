import { useEffect, useInsertionEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import type { ReactiveSignal } from '../internals/reactive.js';
import { checkSignal } from '../internals/get.js';
import { getReactDelivery, runBatch, scheduleReactDelivery, type ReactDelivery } from '../internals/config.js';
import type { PauseSignalsManager } from './pause-signals-context.js';

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

const enum PullResult {
  Current,
  Changed,
  Threw,
}

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
  /** Visible: between the subscription layout effect's setup and cleanup. Only visible readers get deliveries. */
  mounted = false;
  /** The subscription layout effect has run before: its next run is a reveal, not a first mount. */
  connected = false;
  /**
   * A commit included the reader without connecting it: it was committed hidden (prerendered in a
   * hidden `<Activity>`, or mounted into a Suspense-hidden tree), so its first connect is a reveal.
   */
  committedHidden = false;
  /** The subscription currently held, the subscribe function it was made with, and its signal and pause manager. */
  subscribedWith: ((listener: () => void) => () => void) | null = null;
  subscribedSignal: ReactiveSignal<any, any> | null = null;
  pauseManager: PauseSignalsManager | null = null;
  unsubscribe: (() => void) | null = null;
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

  /**
   * Brings the signal up to date the way a read would, and reports whether it moved past the
   * committed version. A signal nobody watched (the reader was hidden, or its render lease expired
   * before the commit) is not recomputed when its dependencies change, so its `updatedCount` alone
   * can be stale.
   */
  pull(): PullResult {
    try {
      checkSignal(this.signal);
    } catch {
      return PullResult.Threw;
    }

    return this.signal.updatedCount !== this.committed ? PullResult.Changed : PullResult.Current;
  }

  subscribe(subscribe: (listener: () => void) => () => void, manager: PauseSignalsManager | null) {
    if (this.subscribedWith === subscribe && this.pauseManager === manager) return;

    this.release();

    // Register before subscribing, so a paused reader never takes the watch.
    manager?.register(this.signal);
    this.subscribedSignal = this.signal;
    this.pauseManager = manager;
    this.unsubscribe = subscribe(this.listener);
    this.subscribedWith = subscribe;
  }

  release() {
    if (this.unsubscribe === null) return;

    this.unsubscribe();
    this.pauseManager?.unregister(this.subscribedSignal!);
    this.unsubscribe = null;
    this.subscribedWith = null;
    this.subscribedSignal = null;
    this.pauseManager = null;
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
 * lease that `subscribe` (the signal's `addListenerLazy` result) represents, pulls the signal and
 * compares the version it rendered with the signal's current one, so a change that landed between
 * render and subscribe is never lost. Notifications are coalesced per reader and flushed together,
 * in one `runBatch`, on `scheduleReactDelivery`. The `setState` runs outside any transition, at
 * React's default priority, which waits for an in-progress transition rather than restarting it.
 *
 * Revealing. When the subscription layout effect connects a reader that was hidden after it
 * rendered, the reader pulls the signal and, if it moved since that render, updates with a
 * `setState` from the layout effect. React renders that synchronously, before the revealing commit
 * paints, so revealed content never shows a stale value; the cost is one SyncLane render of that
 * reader, only when something changed, and nothing when nothing did. A reveal is a reconnect (the
 * content was shown, then hidden) or the first connect of a reader that a commit included while
 * hidden: content prerendered inside a hidden `<Activity>`, which mounts no effects until it is
 * revealed. A first mount is not a reveal: a change between its render and its commit is
 * delivered at default priority like any other, so a screen mounting while data ticks does not
 * pay a second, synchronous render of every reader before it paints.
 *
 * Hiding. A Suspense boundary that hides already-revealed content (react-freeze) disconnects layout
 * effects but not passive ones; `<Activity mode="hidden">` disconnects both. Deliveries follow the
 * layout effect, so a hidden reader is not rendered; the subscription follows the passive effect,
 * so it lives exactly as long as a `useSyncExternalStore` subscription would: a Suspense hide keeps
 * the signal watched (relays stay active), `<Activity>` and unmount release it. When the layout
 * effect reconnects, the reader catches up as above, so revealed content never shows a value that
 * changed while it was hidden.
 */
export function useStateDelivery(
  signal: ReactiveSignal<any, any>,
  subscribe: (listener: () => void) => () => void,
  version: number,
  manager: PauseSignalsManager | null,
): void {
  const [, forceUpdate] = useReducer(increment, 0);
  const [delivery] = useState(() => new StateDelivery(signal, version, forceUpdate));

  // Every commit records what it rendered, then re-checks: a change that arrived while a delivered
  // update was rendering (and was therefore not queued again) is picked up here.
  useCommitEffect(() => {
    delivery.signal = signal;
    delivery.committed = version;
    delivery.awaitingCommit = false;
    delivery.check();
  });

  // Insertion effects run in every commit that includes the reader, hidden or not; layout effects
  // only in visible ones. A visible mount runs both in the same synchronous commit, so a reader
  // still unconnected once that commit's work is done was committed hidden.
  useInsertionEffect(() => {
    if (delivery.connected) return;

    queueMicrotask(() => {
      if (!delivery.connected) delivery.committedHidden = true;
    });
  }, [delivery]);

  useCommitEffect(() => {
    // Runs when the reader becomes visible: its first mount, a reveal, StrictMode's effect replay,
    // or a new signal (whose render may have happened while hidden).
    const revealing = delivery.connected || delivery.committedHidden;

    delivery.connected = true;
    delivery.committedHidden = false;
    delivery.mounted = true;
    delivery.subscribe(subscribe, manager);

    const pulled = delivery.pull();

    if (pulled === PullResult.Threw || (pulled === PullResult.Changed && revealing)) {
      // Render now, before this commit paints; a computation that threw rethrows from the render
      // to the nearest error boundary.
      delivery.awaitingCommit = true;
      forceUpdate();
    } else if (pulled === PullResult.Changed) {
      // A first mount: deliver a change between its render and this commit at default priority.
      delivery.check();
    }

    return () => {
      delivery.mounted = false;
    };
  }, [subscribe, manager]);

  // Releases the subscription on unmount and on `<Activity mode="hidden">`, but not on a Suspense
  // hide, which leaves passive effects connected.
  useEffect(() => () => delivery.release(), [delivery]);
}
