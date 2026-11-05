import { ReactiveSignal, isRelay } from './reactive.js';
import { checkSignal } from './get.js';
import { cancelDeactivate, scheduleDeactivate } from './scheduling.js';

export function watchSignal(signal: ReactiveSignal<any, any>): void {
  const { watchCount } = signal;

  signal.watchCount = watchCount + 1;
  cancelDeactivate(signal);

  if (signal._isActive) {
    return;
  }

  const pausedHeld = signal._isPausedHeld;
  signal._isPausedHeld = false;

  for (const dep of signal.deps.keys()) {
    watchSignal(dep);

    // The watch replaces the hold the pause left.
    if (pausedHeld) dropPausedHold(dep);
  }

  activateSignal(signal);
}

export function unwatchSignal(signal: ReactiveSignal<any, any>) {
  const { watchCount } = signal;
  const newWatchCount = Math.max(watchCount - 1, 0);

  signal.watchCount = newWatchCount;

  if (newWatchCount === 0) {
    scheduleDeactivate(signal);
  }
}

export function activateSignal(signal: ReactiveSignal<any, any>): void {
  cancelDeactivate(signal);

  signal._isActive = true;

  if (isRelay(signal)) {
    checkSignal(signal);
  }
}

/** Drops one paused hold; returns true if it was the last hold on a paused-off signal. */
export function dropPausedHold(signal: ReactiveSignal<any, any>): boolean {
  if (IS_DEV && signal.pausedCount === 0) {
    throw new Error('Paused hold dropped twice, this should not happen. Please open an issue on GitHub.');
  }

  return --signal.pausedCount === 0 && signal._isPausedHeld;
}

/**
 * Settles a signal no watcher holds: an active one deactivates, pausing while it has paused
 * holders, and a paused-off one with no paused holders left gets the cleanup its pause skipped.
 */
export function deactivateSignal(signal: ReactiveSignal<any, any>) {
  const isPausing = signal.pausedCount > 0;

  if (signal._isActive) {
    signal._isActive = false;
    signal._isPausedHeld = isPausing;

    for (const dep of signal.deps.keys()) {
      if (isPausing) dep.pausedCount++;

      const newWatchCount = Math.max(dep.watchCount - 1, 0);
      dep.watchCount = newWatchCount;

      if (newWatchCount === 0) {
        deactivateSignal(dep);
      }
    }
  } else if (signal._isPausedHeld && !isPausing) {
    signal._isPausedHeld = false;

    for (const dep of signal.deps.keys()) {
      if (dropPausedHold(dep)) {
        deactivateSignal(dep);
      }
    }
  } else {
    return;
  }

  if (isRelay(signal)) {
    signal._value?.({ isPausing });
  }
}
