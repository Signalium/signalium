import { ReactiveSignal, isRelay } from './reactive.js';
import { checkSignal } from './get.js';
import { cancelUnwatch, scheduleUnwatch } from './scheduling.js';

const isFullySuspendedCount = (watchCount: number, suspendCount: number): boolean => {
  return watchCount > 0 && suspendCount === watchCount;
};

const enterFullySuspended = (signal: ReactiveSignal<any, any>) => {
  if (signal.isFullySuspended) {
    return;
  }

  signal.isFullySuspended = true;
  signal.scope?.removeFromGc(signal);

  for (const dep of signal.deps.keys()) {
    suspendSignalWatch(dep);
    unwatchSignal(dep);
  }

  if (isRelay(signal)) {
    // Teardown relay side effects while fully suspended.
    signal._value?.();
  }
};

const exitFullySuspended = (signal: ReactiveSignal<any, any>) => {
  if (!signal.isFullySuspended) {
    return;
  }

  signal.isFullySuspended = false;

  for (const dep of signal.deps.keys()) {
    if (signal.watchCount > 0) {
      watchSignal(dep);
    }

    resumeSignalWatch(dep);
  }
};

export function watchSignal(signal: ReactiveSignal<any, any>): void {
  const wasFullySuspended = signal.isFullySuspended;
  const { watchCount } = signal;
  const newWatchCount = watchCount + 1;

  signal.watchCount = newWatchCount;
  signal.pendingUnwatchCount = 0;
  cancelUnwatch(signal);

  const isFullySuspended = isFullySuspendedCount(newWatchCount, signal.suspendCount);

  if (!wasFullySuspended && isFullySuspended) {
    enterFullySuspended(signal);
  }

  if (wasFullySuspended && !isFullySuspended) {
    exitFullySuspended(signal);
  }

  if (isFullySuspended) {
    return;
  }

  // If > 0, already watching, return
  if (watchCount > 0) return;

  // If signal is being watched again, remove from GC candidates and add back to scope
  signal.scope?.removeFromGc(signal);

  for (const dep of signal.deps.keys()) {
    watchSignal(dep);
  }

  if (isRelay(signal)) {
    // Bootstrap the relay
    checkSignal(signal);
  }
}

export function unwatchSignal(signal: ReactiveSignal<any, any>, count = 1) {
  const wasFullySuspended = signal.isFullySuspended;
  const { watchCount } = signal;
  const newWatchCount = Math.max(watchCount - count, 0);

  signal.watchCount = newWatchCount;

  const isFullySuspended = isFullySuspendedCount(newWatchCount, signal.suspendCount);

  if (!wasFullySuspended && isFullySuspended) {
    enterFullySuspended(signal);
  }

  if (newWatchCount > 0) {
    return;
  }

  if (signal.suspendCount > 0) {
    signal.pendingUnwatchCount += count;
    enterFullySuspended(signal);
    return;
  }

  for (const dep of signal.deps.keys()) {
    unwatchSignal(dep);
  }

  if (isRelay(signal)) {
    // teardown the relay
    signal._value?.();
  }

  // If watchCount is now zero, mark the signal for GC
  if (newWatchCount === 0 && signal.scope) {
    signal.scope.markForGc(signal);
  }
}

export function suspendSignalWatch(signal: ReactiveSignal<any, any>): void {
  const wasFullySuspended = signal.isFullySuspended;
  const suspendCount = signal.suspendCount + 1;
  signal.suspendCount = suspendCount;

  const isFullySuspended = isFullySuspendedCount(signal.watchCount, suspendCount);

  if (!wasFullySuspended && isFullySuspended) {
    enterFullySuspended(signal);
  }
}

export function resumeSignalWatch(signal: ReactiveSignal<any, any>): void {
  const wasFullySuspended = signal.isFullySuspended;
  const suspendCount = Math.max(signal.suspendCount - 1, 0);
  signal.suspendCount = suspendCount;

  const isFullySuspended = isFullySuspendedCount(signal.watchCount, suspendCount);

  if (wasFullySuspended && !isFullySuspended) {
    exitFullySuspended(signal);
  }

  if (suspendCount > 0) {
    return;
  }

  if (signal.watchCount === 0 && signal.pendingUnwatchCount > 0) {
    const pendingUnwatchCount = signal.pendingUnwatchCount;
    signal.pendingUnwatchCount = 0;
    scheduleUnwatch(signal, pendingUnwatchCount);
  }
}
