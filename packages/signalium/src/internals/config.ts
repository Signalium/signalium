export let scheduleFlush: (fn: () => void) => void = flushWatchers => {
  setTimeout(() => {
    flushWatchers();
  }, 0);
};

export let runBatch: (fn: () => void) => void = fn => fn();

export function setConfig(
  cfg: Partial<{
    scheduleFlush: (fn: () => void) => void;
    runBatch: (fn: () => void) => void;
  }>,
) {
  scheduleFlush = cfg.scheduleFlush ?? scheduleFlush;
  runBatch = cfg.runBatch ?? runBatch;
}
