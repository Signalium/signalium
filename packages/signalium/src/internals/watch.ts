import { ReactiveSignal, isRelay } from './reactive.js';
import { checkSignal } from './get.js';

export function watchSignal(signal: ReactiveSignal<any, any>): void {
  const { watchCount } = signal;
  const newWatchCount = watchCount + 1;

  signal.watchCount = newWatchCount;

  // If > 0, already watching, return
  if (watchCount > 0) return;

  // If we deferred teardown while retained, the graph is still connected.
  // Rewatching should clear the deferred flag without recursively rewatching deps.
  if (signal.hasDeferredUnwatch) {
    signal.hasDeferredUnwatch = false;
    return;
  }

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

function teardownUnwatchedSignal(signal: ReactiveSignal<any, any>) {
  for (const dep of signal.deps.keys()) {
    unwatchSignal(dep);
  }

  if (isRelay(signal)) {
    // teardown the relay
    signal._value?.();
  }

  // If watchCount is now zero, mark the signal for GC
  if (signal.scope) {
    signal.scope.markForGc(signal);
  }
}

export function unwatchSignal(signal: ReactiveSignal<any, any>, count = 1) {
  const { watchCount } = signal;
  const newWatchCount = Math.max(watchCount - count, 0);

  signal.watchCount = newWatchCount;

  if (newWatchCount > 0) {
    return;
  }

  if (signal.retainCount > 0) {
    signal.hasDeferredUnwatch = true;
    return;
  }

  teardownUnwatchedSignal(signal);
}

export function retainSignal(signal: ReactiveSignal<any, any>) {
  signal.retainCount++;
}

export function releaseSignal(signal: ReactiveSignal<any, any>) {
  signal.retainCount = Math.max(signal.retainCount - 1, 0);
}

export function flushDeferredUnwatch(signal: ReactiveSignal<any, any>) {
  if (signal.retainCount > 0 || signal.watchCount > 0 || !signal.hasDeferredUnwatch) {
    return;
  }

  signal.hasDeferredUnwatch = false;
  teardownUnwatchedSignal(signal);
}
