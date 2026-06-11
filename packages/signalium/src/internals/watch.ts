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

  for (const dep of signal.deps.keys()) {
    watchSignal(dep);
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

export function deactivateSignal(signal: ReactiveSignal<any, any>, options: DeactivateOptions = {}) {
  signal._isActive = false;

  for (const dep of signal.deps.keys()) {
    const newWatchCount = Math.max(dep.watchCount - 1, 0);
    dep.watchCount = newWatchCount;

    if (newWatchCount === 0) {
      deactivateSignal(dep, options);
    }
  }

  if (isRelay(signal)) {
    signal._value?.(options);
  }
}
