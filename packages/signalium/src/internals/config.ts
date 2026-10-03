let _scheduleFlush: (fn: () => void) => void = flushWatchers => {
  setTimeout(() => {
    flushWatchers();
  }, 0);
};

let _runBatch: (fn: () => void) => void = fn => fn();

/**
 * Default lifetime of a render lease, in ms. It must outlive the gap between a React render and
 * its commit, which for a concurrent (transition) render can last until React's 5 s transition
 * expiry forces it to finish synchronously.
 */
export const DEFAULT_RENDER_LEASE_TTL = 10_000;

let _renderLeaseTtl = DEFAULT_RENDER_LEASE_TTL;

/** The longest delay `setTimeout` honours (2^31 - 1 ms, ~24.8 days); longer delays fire at once. */
export const MAX_TIMEOUT = 2 ** 31 - 1;

/**
 * Validates `renderLeaseTtl`. A TTL is a timer delay, so it must be a positive number no larger
 * than {@link MAX_TIMEOUT}: `setTimeout` treats anything larger (including `Infinity`) as 0, which
 * would release every render lease on the next tick. Larger values are clamped; anything else is
 * ignored. Both warn in development.
 */
function validateRenderLeaseTtl(ttl: number): number {
  if (typeof ttl !== 'number' || Number.isNaN(ttl) || ttl <= 0) {
    if (IS_DEV) {
      console.warn(
        `signalium: setConfig({ renderLeaseTtl: ${String(ttl)} }) ignored; it must be a positive number of milliseconds.`,
      );
    }

    return _renderLeaseTtl;
  }

  if (ttl > MAX_TIMEOUT) {
    if (IS_DEV) {
      console.warn(
        `signalium: setConfig({ renderLeaseTtl: ${String(ttl)} }) clamped to ${MAX_TIMEOUT} ms, the longest timer delay.`,
      );
    }

    return MAX_TIMEOUT;
  }

  return ttl;
}

/**
 * How React readers (`component()`, `useReactive`, `useReactiveShallow`) learn that their signal
 * changed.
 *
 * - `'sync'` (default): through `useSyncExternalStore`. Every update renders at SyncLane, so the
 *   tree is never torn, but each update also throws away any in-progress transition render; under
 *   a steady stream of updates a transition only finishes once React's expiry forces it through.
 * - `'state'`: the reader subscribes on commit and delivers changes with a `setState` (DefaultLane),
 *   coalesced per reader and batched across readers. Default-lane updates wait for an in-progress
 *   transition instead of restarting it. The trade-off is consistency: updates are consistent
 *   within a delivery batch, but a reader that mounts while a delivery is pending can show a newer
 *   value than an already-mounted reader for one commit. Readers whose values must stay correlated
 *   with each other in every commit should use `'sync'`.
 */
export type ReactDelivery = 'sync' | 'state';

let _reactDelivery: ReactDelivery = 'sync';

const resolvedPromise = Promise.resolve();

let _scheduleReactDelivery: (fn: () => void) => void = fn => {
  resolvedPromise.then(fn);
};

export function setConfig(
  cfg: Partial<{
    scheduleFlush: (fn: () => void) => void;
    runBatch: (fn: () => void) => void;
    /**
     * Minimum time (ms) a watch taken while rendering stays alive without being claimed by the
     * commit (the store subscription). A render React discards — an interrupted transition, a
     * mount that suspends, a StrictMode double render — releases its watch after between one
     * and two TTLs. Defaults to {@link DEFAULT_RENDER_LEASE_TTL}. Must be positive; values above
     * {@link MAX_TIMEOUT} (including `Infinity`) are clamped to it.
     */
    renderLeaseTtl: number;
    /**
     * Default delivery mode for React readers; see {@link ReactDelivery}. Read when a reader
     * mounts, so changing it affects readers mounted afterwards. `component()`, `useReactive` and
     * `useReactiveShallow` accept a per-call `{ delivery }` override. Defaults to `'sync'`.
     */
    reactDelivery: ReactDelivery;
    /**
     * Schedules a flush of pending `'state'` deliveries. All readers notified before the flush
     * runs are updated together, inside `runBatch`. Defaults to a microtask. Must not run the
     * flush inside `startTransition`, or deliveries would take the transition's lane.
     */
    scheduleReactDelivery: (fn: () => void) => void;
  }>,
) {
  _scheduleFlush = cfg.scheduleFlush ?? _scheduleFlush;
  _runBatch = cfg.runBatch ?? _runBatch;
  if (cfg.renderLeaseTtl !== undefined) {
    _renderLeaseTtl = validateRenderLeaseTtl(cfg.renderLeaseTtl);
  }
  _reactDelivery = cfg.reactDelivery ?? _reactDelivery;
  _scheduleReactDelivery = cfg.scheduleReactDelivery ?? _scheduleReactDelivery;
}

export const scheduleFlush = (fn: () => void) => {
  _scheduleFlush(fn);
};

export const runBatch = (fn: () => void) => {
  _runBatch(fn);
};

export const getRenderLeaseTtl = () => _renderLeaseTtl;

export const getReactDelivery = () => _reactDelivery;

export const scheduleReactDelivery = (fn: () => void) => {
  _scheduleReactDelivery(fn);
};
