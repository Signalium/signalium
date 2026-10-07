let _scheduleFlush: (fn: () => void) => void = flushWatchers => {
  setTimeout(() => {
    flushWatchers();
  }, 0);
};

let _runBatch: (fn: () => void) => void = fn => fn();

/** Default render lease TTL (ms). It must outlive a transition render, which React caps at 5 s. */
export const DEFAULT_RENDER_LEASE_TTL = 10_000;

let _renderLeaseTtl = DEFAULT_RENDER_LEASE_TTL;

/** The longest `setTimeout` delay (2^31 - 1 ms); longer ones fire immediately. */
export const MAX_TIMEOUT = 2 ** 31 - 1;

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
     * How long (ms) a watch taken during render survives without a commit claiming it. A
     * discarded render releases its watch after one to two TTLs. Defaults to 10 s; values above
     * 2^31 - 1 ms are clamped.
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
