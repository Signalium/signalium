import { ReactiveSignal, isRelay } from './reactive.js';
import { checkSignal } from './get.js';
import { cancelDeactivate, scheduleDeactivate } from './scheduling.js';

export function watchSignal(signal: ReactiveSignal<any, any>, parentIsSuspended: boolean): void {
  if (parentIsSuspended) {
    watchSuspendedSignal(signal);
  } else {
    watchActiveSignal(signal);
  }
}

export function unwatchSignal(signal: ReactiveSignal<any, any>, parentIsSuspended: boolean): void {
  if (parentIsSuspended) {
    unwatchSuspendedSignal(signal);
  } else {
    unwatchActiveSignal(signal);
  }
}

function watchActiveSignal(signal: ReactiveSignal<any, any>): void {
  const { watchCount } = signal;
  const newWatchCount = watchCount + 1;

  signal.watchCount = newWatchCount;
  cancelDeactivate(signal);

  if (signal._isActive) {
    return;
  }

  for (const dep of signal.deps.keys()) {
    watchActiveSignal(dep);
  }

  activateSignal(signal);
}

function unwatchActiveSignal(signal: ReactiveSignal<any, any>) {
  const { watchCount } = signal;
  const newWatchCount = Math.max(watchCount - 1, 0);

  signal.watchCount = newWatchCount;

  if (newWatchCount === 0) {
    scheduleDeactivate(signal);
  }
}

function watchSuspendedSignal(signal: ReactiveSignal<any, any>): void {
  const { watchCount, suspendCount } = signal;

  const newWatchCount = watchCount + 1;
  const newSuspendCount = suspendCount + 1;

  signal.watchCount = newWatchCount;
  signal.suspendCount = newSuspendCount;

  cancelDeactivate(signal);

  // If the original watch count was 0, we need to propagate the watch + suspend
  // to dependencies because we are becoming watched. BUT, we don't need to
  // activate, because the signal is not changing state in this case. It is
  // moving from unwatched -> suspended, which means we _do not_ activate.
  if (watchCount === 0) {
    for (const dep of signal.deps.keys()) {
      watchSuspendedSignal(dep);
    }
  }
}

function unwatchSuspendedSignal(signal: ReactiveSignal<any, any>): void {
  const { watchCount, suspendCount } = signal;

  const newWatchCount = Math.max(watchCount - 1, 0);
  const newSuspendCount = Math.max(suspendCount - 1, 0);

  signal.watchCount = newWatchCount;
  signal.suspendCount = newSuspendCount;

  // We _do_ need to schedule deactivate if we are no longer watched, because
  // the signal is now becoming inactive.
  if (newWatchCount === 0) {
    scheduleDeactivate(signal);
  }
}

export function resumeSignal(signal: ReactiveSignal<any, any>): void {
  const { watchCount, suspendCount } = signal;
  const newSuspendCount = Math.max(suspendCount - 1, 0);

  signal.suspendCount = newSuspendCount;
  cancelDeactivate(signal);

  if (watchCount > 0 && !signal._isActive) {
    for (const dep of signal.deps.keys()) {
      resumeSignal(dep);
    }

    activateSignal(signal);
  }
}

export function suspendSignal(signal: ReactiveSignal<any, any>): void {
  const { watchCount, suspendCount } = signal;
  const newSuspendCount = suspendCount + 1;

  signal.suspendCount = newSuspendCount;

  if (watchCount > 0 && newSuspendCount === watchCount) {
    scheduleDeactivate(signal);
  }
}

function activateSignal(signal: ReactiveSignal<any, any>): void {
  // If signal is being watched again, remove from GC candidates and add back to scope
  signal.scope?.removeFromGc(signal);
  cancelDeactivate(signal);

  signal._isActive = true;

  if (isRelay(signal)) {
    // Bootstrap the relay
    checkSignal(signal);
  }
}

export function deactivateSignal(signal: ReactiveSignal<any, any>) {
  const { watchCount, suspendCount } = signal;

  signal._isActive = false;
  const isSuspending = watchCount > 0 && suspendCount === watchCount;

  for (const dep of signal.deps.keys()) {
    const { watchCount: depWatchCount, suspendCount: depSuspendCount } = dep;

    if (isSuspending) {
      const newSuspendCount = (dep.suspendCount = depSuspendCount + 1);

      if (newSuspendCount === depWatchCount) {
        deactivateSignal(dep);
      }
    } else {
      const newWatchCount = (dep.watchCount = depWatchCount - 1);

      if (newWatchCount === 0) {
        deactivateSignal(dep);
      }
    }
  }

  if (isRelay(signal)) {
    // teardown the relay
    signal._value?.();
  }

  // If watchCount is now zero, mark the signal for GC
  if (watchCount === 0) {
    signal.scope?.markForGc(signal);
    signal.reset();
  }
}
