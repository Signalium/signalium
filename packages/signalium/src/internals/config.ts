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
  }>,
) {
  _scheduleFlush = cfg.scheduleFlush ?? _scheduleFlush;
  _runBatch = cfg.runBatch ?? _runBatch;
  if (cfg.renderLeaseTtl !== undefined) {
    _renderLeaseTtl = validateRenderLeaseTtl(cfg.renderLeaseTtl);
  }
}

export const scheduleFlush = (fn: () => void) => {
  _scheduleFlush(fn);
};

export const runBatch = (fn: () => void) => {
  _runBatch(fn);
};

export const getRenderLeaseTtl = () => _renderLeaseTtl;
