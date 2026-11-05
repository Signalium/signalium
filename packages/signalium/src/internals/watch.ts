import { ReactiveSignal, isRelay } from './reactive.js';
import type { DeactivateOptions } from '../types.js';
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
    if (pausedHeld) dep.pausedCount = Math.max(dep.pausedCount - 1, 0);
  }

  activateSignal(signal);
}

export function unwatchSignal(signal: ReactiveSignal<any, any>, options: DeactivateOptions = {}) {
  const { watchCount } = signal;
  const newWatchCount = Math.max(watchCount - 1, 0);

  signal.watchCount = newWatchCount;

  if (newWatchCount === 0) {
    scheduleDeactivate(signal, options);
  }
}

export function activateSignal(signal: ReactiveSignal<any, any>): void {
  cancelDeactivate(signal);

  signal._isActive = true;

  if (isRelay(signal)) {
    checkSignal(signal);
  }
}

/** Drops one paused hold. Dropping the last gives a paused-off signal, and the deps only it held, the cleanup the pause skipped. */
export function dropPausedHold(signal: ReactiveSignal<any, any>) {
  signal.pausedCount = Math.max(signal.pausedCount - 1, 0);

  if (signal.pausedCount > 0 || !signal._isPausedHeld) return;

  signal._isPausedHeld = false;

  for (const dep of signal.deps.keys()) {
    dropPausedHold(dep);
  }

  if (isRelay(signal)) {
    signal._value?.();
  }
}

export function deactivateSignal(signal: ReactiveSignal<any, any>, options: DeactivateOptions = {}) {
  const { isPausing = false } = options;

  signal._isActive = false;

  if (isPausing) signal._isPausedHeld = true;

  for (const dep of signal.deps.keys()) {
    const newWatchCount = Math.max(dep.watchCount - 1, 0);
    dep.watchCount = newWatchCount;

    if (isPausing) dep.pausedCount++;

    if (newWatchCount === 0) {
      deactivateSignal(dep, options);
    }
  }

  if (isRelay(signal)) {
    signal._value?.(options);
  }
}
