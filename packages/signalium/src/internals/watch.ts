import { ReactiveSignal, isRelay } from './reactive.js';
import { checkSignal } from './get.js';
import { cancelDeactivate, scheduleDeactivate } from './scheduling.js';
import { EdgeType } from './edge.js';

export function watchSignal(signal: ReactiveSignal<any, any>): void {
  const { watchCount } = signal;

  signal.watchCount = watchCount + 1;
  cancelDeactivate(signal);

  if (signal._isActive) {
    return;
  }

  let edge = signal.depsHead;
  while (edge !== undefined) {
    if (edge.type === EdgeType.Signal) {
      watchSignal(edge.dep);
    }
    edge = edge.nextDep;
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

export function deactivateSignal(signal: ReactiveSignal<any, any>) {
  signal._isActive = false;

  let edge = signal.depsHead;
  while (edge !== undefined) {
    if (edge.type !== EdgeType.Signal) {
      edge = edge.nextDep;
      continue;
    }

    const dep = edge.dep;
    const newWatchCount = Math.max(dep.watchCount - 1, 0);
    dep.watchCount = newWatchCount;

    if (newWatchCount === 0) {
      deactivateSignal(dep);
    }
    edge = edge.nextDep;
  }

  if (isRelay(signal)) {
    signal._value?.();
  }
}
