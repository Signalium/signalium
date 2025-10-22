let _scheduleFlush: (fn: () => void) => void = flushWatchers => {
  setTimeout(() => {
    flushWatchers();
  }, 0);
};

let _runBatch: (fn: () => void) => void = fn => fn();

export function setConfig(
  cfg: Partial<{
    scheduleFlush: (fn: () => void) => void;
    runBatch: (fn: () => void) => void;
  }>,
) {
  _scheduleFlush = cfg.scheduleFlush ?? _scheduleFlush;
  _runBatch = cfg.runBatch ?? _runBatch;
}

export const scheduleFlush = (fn: () => void) => {
  _scheduleFlush(fn);
};

export const runBatch = (fn: () => void) => {
  _runBatch(fn);
};
