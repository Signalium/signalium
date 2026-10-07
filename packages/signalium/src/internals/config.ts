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
