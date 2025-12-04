import { scheduleListeners, scheduleTracer, scheduleUnwatch } from './scheduling.js';
import { SignalType, getTracerProxy, TracerEventType } from './trace.js';
import { ReactiveSignal, ReactiveFnState, isRelay } from './reactive.js';
import { createEdge, Edge, EdgeType } from './edge.js';
import { watchSignal } from './watch.js';
import { createPromise, isReactivePromise, ReactivePromiseImpl } from './async.js';
import { ReactiveValue } from '../types.js';
import { isGeneratorResult, isPromise } from './utils/type-utils.js';
import { getCurrentConsumer, setCurrentConsumer } from './consumer.js';
import { generatorResultToPromiseWithConsumer } from './generators.js';

export function getSignal<T, Args extends unknown[]>(signal: ReactiveSignal<T, Args>): ReactiveValue<T> {
  const currentConsumer = getCurrentConsumer();
  if (currentConsumer !== undefined) {
    const { ref, computedCount, deps } = currentConsumer;
    const prevEdge = deps.get(signal);

    const prevConsumedAt = prevEdge?.consumedAt;

    if (prevConsumedAt !== computedCount) {
      if (prevEdge === undefined) {
        getTracerProxy()?.emit({
          type: TracerEventType.Connected,
          id: currentConsumer.tracerMeta!.id,
          childId: signal.tracerMeta!.id,
          name: signal.tracerMeta!.desc,
          params: signal.tracerMeta!.params,
          nodeType: SignalType.Reactive,
        });

        if (currentConsumer.watchCount > 0) {
          watchSignal(signal);
        }
      }

      const updatedAt = checkSignal(signal);
      const newEdge = createEdge(prevEdge, EdgeType.Signal, signal, updatedAt, computedCount);

      signal.subs.set(ref, newEdge);
      deps.set(signal, newEdge);
    } else {
      const updatedAt = checkSignal(signal);

      if (prevEdge !== undefined) {
        prevEdge.updatedAt = updatedAt;
      }
    }
  } else {
    checkSignal(signal);
  }

  return signal._value as ReactiveValue<T>;
}

export function checkSignal(signal: ReactiveSignal<any, any>): number {
  const { ref, _state: state } = signal;

  if (state < ReactiveFnState.Dirty) {
    return signal.updatedCount;
  }

  if (state >= ReactiveFnState.MaybeDirty) {
    let edge: Edge | undefined = signal.dirtyHead;

    while (edge !== undefined) {
      if (edge.type === EdgeType.Promise) {
        const dep = edge.dep;

        // If the dependency is pending, then we need to propagate the pending state to the
        // parent signal, and we halt the computation here.
        if (dep.isPending) {
          const value = signal._value;

          // Add the signal to the awaitSubs map to be notified when the promise is resolved
          dep['_awaitSubs'].set(ref, edge);

          // Propagate the pending state to the parent signal
          (value as ReactivePromiseImpl<unknown>)._setPending();
          signal._state = ReactiveFnState.Pending;
          signal.dirtyHead = edge;

          // Early return to prevent the signal from being computed and to preserve the dirty state
          return signal.updatedCount;
        } else if (edge.updatedAt !== edge.dep._updatedCount) {
          signal.dirtyHead = edge.nextDirty;
          signal._state = ReactiveFnState.Dirty;
          break;
        }

        edge = edge.nextDirty;
        continue;
      }

      const dep = edge.dep;
      const updatedAt = checkSignal(dep);

      dep.subs.set(ref, edge);

      if (edge.updatedAt !== updatedAt) {
        signal.dirtyHead = edge.nextDirty;
        signal._state = ReactiveFnState.Dirty;
        break;
      }

      edge = edge.nextDirty;
    }
  }

  const newState = signal._state;

  // If the signal is dirty, we need to run it. This should always be checked
  // directly on the signal instance, because the state could have been changed
  // mid computation and not just through direct dependencies.
  if (newState === ReactiveFnState.Dirty) {
    if (signal._isLazy) {
      signal.updatedCount++;
    } else {
      runSignal(signal);
    }
  } else if (newState === ReactiveFnState.PendingDirty) {
    (signal._value as ReactivePromiseImpl<unknown>)._clearPending();
  }

  signal._state = ReactiveFnState.Clean;
  signal.dirtyHead = undefined;

  if (getTracerProxy() !== undefined && signal.tracerMeta?.tracer) {
    scheduleTracer(signal.tracerMeta.tracer);
  }

  return signal.updatedCount;
}

export function runSignal(signal: ReactiveSignal<any, any[]>) {
  let tracer = getTracerProxy();
  tracer?.emit({
    type: TracerEventType.StartUpdate,
    id: signal.tracerMeta!.id,
  });

  const prevConsumer = getCurrentConsumer();

  const updatedCount = signal.updatedCount;
  const computedCount = ++signal.computedCount;

  try {
    setCurrentConsumer(signal);

    const initialized = updatedCount !== 0;
    const prevValue = signal._value;
    let nextValue = signal.def.compute(...signal.args);
    let valueIsPromise = false;

    if (nextValue !== null && typeof nextValue === 'object') {
      if (isGeneratorResult(nextValue)) {
        nextValue = generatorResultToPromiseWithConsumer(nextValue, signal);
        valueIsPromise = true;
      } else if (isPromise(nextValue)) {
        valueIsPromise = true;
      }
    }

    if (valueIsPromise) {
      if (prevValue !== null && typeof prevValue === 'object' && isReactivePromise(prevValue)) {
        // Update the AsyncSignal with the new promise. Since the value
        // returned from the function is the same AsyncSignal instance,
        // we don't need to increment the updatedCount, because the returned
        // value is the same. _setPromise will update the nested values on the
        // AsyncSignal instance, and consumers of those values will be notified
        // of the change through that.
        prevValue['_setPromise'](nextValue);
      } else {
        signal._value = createPromise(nextValue, signal);
        signal.updatedCount = updatedCount + 1;
      }
    } else {
      if (!initialized || !signal.def.equals(prevValue!, nextValue)) {
        signal._value = nextValue;
        // If the signal is lazy, we don't want to increment the updatedCount, it
        // has already been updated
        signal.updatedCount = signal._isLazy ? updatedCount : updatedCount + 1;
      }

      // Disconnect the signal from all its previous dependencies synchronously
      disconnectSignal(signal);
    }
  } finally {
    setCurrentConsumer(prevConsumer);

    tracer?.emit({
      type: TracerEventType.EndUpdate,
      id: signal.tracerMeta!.id,
      value: isRelay(signal) ? '...' : signal._value,
    });
  }
}

export function disconnectSignal(signal: ReactiveSignal<any, any>) {
  const { ref, computedCount, deps } = signal;

  for (const [dep, edge] of deps) {
    if (edge.consumedAt !== computedCount) {
      scheduleUnwatch(dep);
      dep.subs.delete(ref);
      deps.delete(dep);
    }
  }
}

export function checkAndRunListeners(signal: ReactiveSignal<any, any>) {
  const listeners = signal.listeners;

  let updatedCount = checkSignal(signal);

  if (listeners !== null && listeners.updatedAt !== updatedCount) {
    listeners.updatedAt = updatedCount;

    scheduleListeners(signal);
  }

  return updatedCount;
}
