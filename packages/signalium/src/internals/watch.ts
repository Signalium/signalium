import { ReactiveSignal, isRelay } from './reactive.js';
import { checkSignal } from './get.js';

export function watchSignal(signal: ReactiveSignal<any, any>): void {
  const { watchCount } = signal;
  const newWatchCount = watchCount + 1;

  signal.watchCount = newWatchCount;

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
  const { watchCount } = signal;
  const newWatchCount = Math.max(watchCount - count, 0);

  signal.watchCount = newWatchCount;

  if (newWatchCount > 0) {
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
