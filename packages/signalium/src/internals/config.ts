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

export function setConfig(
  cfg: Partial<{
    scheduleFlush: (fn: () => void) => void;
    runBatch: (fn: () => void) => void;
    /**
     * Minimum time (ms) a watch taken while rendering stays alive without being claimed by the
     * commit (the store subscription). A render React discards — an interrupted transition, a
     * mount that suspends, a StrictMode double render — releases its watch after between one
     * and two TTLs. Defaults to {@link DEFAULT_RENDER_LEASE_TTL}.
     */
    renderLeaseTtl: number;
  }>,
) {
  _scheduleFlush = cfg.scheduleFlush ?? _scheduleFlush;
  _runBatch = cfg.runBatch ?? _runBatch;
  _renderLeaseTtl = cfg.renderLeaseTtl ?? _renderLeaseTtl;
}

export const scheduleFlush = (fn: () => void) => {
  _scheduleFlush(fn);
};

export const runBatch = (fn: () => void) => {
  _runBatch(fn);
};

export const getRenderLeaseTtl = () => _renderLeaseTtl;
