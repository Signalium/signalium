import { ReactiveValue } from '../types.js';
import { createPromise, isReactivePromise, ReactivePromiseImpl } from './async.js';
import { getCurrentConsumer, setCurrentConsumer } from './consumer.js';
import { nextOrd, EdgeBase, Edge, EdgeType, linkSub, unlinkSub } from './edge.js';
import { generatorResultToPromiseWithConsumer } from './generators.js';
import { ReactiveFnState, isRelay, ReactiveSignal } from './reactive.js';
import type { Effect } from './effect.js';
import { scheduleListeners, scheduleTracer } from './scheduling.js';
import { getTracerProxy, SignalType, TracerEventType } from './trace.js';
import { isGeneratorResult, isPromise } from './utils/type-utils.js';
import { unwatchSignal, watchSignal } from './watch.js';

export function getSignal<T, Args extends unknown[]>(signal: ReactiveSignal<T, Args>): ReactiveValue<T> {
  const currentConsumer = getCurrentConsumer();
  if (currentConsumer !== undefined) {
    const cursor = currentConsumer.depsTail;
    const nextEdge = cursor !== undefined ? cursor.nextDep : currentConsumer.depsHead;

    if (nextEdge !== undefined && nextEdge.dep === signal) {
      currentConsumer.depsTail = nextEdge;
      const updatedAt = checkSignal(signal);
      nextEdge.updatedAt = updatedAt;
      nextEdge.consumedAt = currentConsumer.computedCount;
      nextEdge.ord = nextOrd();
      linkSub(signal, nextEdge);
    } else {
      getSignalSlow(signal, currentConsumer, cursor, nextEdge);
    }
  } else {
    checkSignal(signal);
  }

  return signal._value as ReactiveValue<T>;
}

function getSignalSlow(
  signal: ReactiveSignal<any, any>,
  currentConsumer: ReactiveSignal<any, any> | Effect,
  cursor: Edge | undefined,
  nextEdge: Edge | undefined,
): void {
  const { ref, computedCount } = currentConsumer;

  // Skip Promise edges that may sit between cursor and the next Signal edge
  while (nextEdge !== undefined && nextEdge.type === EdgeType.Promise) {
    cursor = nextEdge;
    nextEdge = nextEdge.nextDep;
  }

  if (nextEdge !== undefined && nextEdge.dep === signal) {
    currentConsumer.depsTail = nextEdge;
    const updatedAt = checkSignal(signal);
    nextEdge.updatedAt = updatedAt;
    nextEdge.consumedAt = computedCount;
    nextEdge.ord = nextOrd();
    linkSub(signal, nextEdge);
    return;
  }

  // Check if this dep was already consumed earlier in this computation
  let subEdge = signal.subsHead;
  while (subEdge !== undefined) {
    if (subEdge.sub === currentConsumer && subEdge.consumedAt === computedCount) {
      const updatedAt = checkSignal(signal);
      subEdge.updatedAt = updatedAt;
      return;
    }
    subEdge = subEdge.nextSub;
  }

  if (IS_DEV) {
    getTracerProxy()?.emit({
      type: TracerEventType.Connected,
      id: currentConsumer.tracerMeta!.id,
      childId: signal.tracerMeta!.id,
      name: signal.tracerMeta!.desc,
      params: signal.tracerMeta!.params,
      nodeType: SignalType.Reactive,
    });
  }

  if (currentConsumer.watchCount > 0) {
    watchSignal(signal);
  }

  const updatedAt = checkSignal(signal);

  const newEdge = new EdgeBase(
    EdgeType.Signal, signal, updatedAt, computedCount, ref, currentConsumer,
  ) as Edge;
  linkSub(signal, newEdge);

  newEdge.prevDep = cursor;
  newEdge.nextDep = nextEdge;

  if (cursor !== undefined) {
    cursor.nextDep = newEdge;
  } else {
    currentConsumer.depsHead = newEdge;
  }

  if (nextEdge !== undefined) {
    nextEdge.prevDep = newEdge;
  }

  currentConsumer.depsTail = newEdge;
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

        if (dep._getPending()) {
          const value = signal._value;

          dep['_awaitSubs'].set(ref, edge);

          (value as ReactivePromiseImpl<unknown>)._setPending();
          signal._state = ReactiveFnState.Pending;
          signal.dirtyHead = edge;

          return signal.updatedCount;
        } else if (edge.updatedAt === edge.dep._updatedCount) {
          dep['_awaitSubs'].set(ref, edge);
        } else {
          signal.dirtyHead = edge.nextDirty;
          signal._state = ReactiveFnState.Dirty;
          break;
        }

        edge = edge.nextDirty;
        continue;
      }

      const dep = edge.dep;
      const updatedAt = checkSignal(dep);

      linkSub(dep, edge);

      if (edge.updatedAt !== updatedAt) {
        signal.dirtyHead = edge.nextDirty;
        signal._state = ReactiveFnState.Dirty;
        break;
      }

      edge = edge.nextDirty;
    }
  }

  const newState = signal._state;

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
  signal.dirtyEpoch++;

  if (IS_DEV && getTracerProxy() !== undefined && signal.tracerMeta?.tracer) {
    scheduleTracer(signal.tracerMeta.tracer);
  }

  return signal.updatedCount;
}

export function runSignal(signal: ReactiveSignal<any, any[]>) {
  let tracer: ReturnType<typeof getTracerProxy> | undefined;
  if (IS_DEV) {
    tracer = getTracerProxy();
    tracer?.emit({
      type: TracerEventType.StartUpdate,
      id: signal.tracerMeta!.id,
    });
  }

  const prevConsumer = getCurrentConsumer();

  const updatedCount = signal.updatedCount;
  const computedCount = ++signal.computedCount;

  try {
    signal.depsTail = undefined;
    signal.stateDeps = null;
    setCurrentConsumer(signal);

    const initialized = updatedCount !== 0;
    const prevValue = signal._value;
    const args = signal.args;
    let nextValue: any =
      args === undefined || args.length === 0 ? (signal.def.compute as () => any)() : signal.def.compute(...args);
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
        prevValue['_setPromise'](nextValue);
      } else {
        signal._value = createPromise(nextValue, signal);
        signal.updatedCount = updatedCount + 1;
      }
    } else {
      if (!initialized || !signal.def.equals(prevValue!, nextValue)) {
        signal._value = nextValue;
        signal.updatedCount = signal._isLazy ? updatedCount : updatedCount + 1;
      }

      disconnectSignal(signal);
    }
  } finally {
    setCurrentConsumer(prevConsumer);

    if (IS_DEV) {
      tracer?.emit({
        type: TracerEventType.EndUpdate,
        id: signal.tracerMeta!.id,
        value: isRelay(signal) ? '...' : signal._value,
      });
    }
  }
}

export function disconnectSignal(
  consumer: ReactiveSignal<any, any> | Effect,
) {
  const cursor = consumer.depsTail;
  let edge = cursor !== undefined ? cursor.nextDep : consumer.depsHead;

  if (edge === undefined) return;

  if (cursor !== undefined) {
    cursor.nextDep = undefined;
  } else {
    consumer.depsHead = undefined;
  }

  let lastKept = cursor;

  while (edge !== undefined) {
    const next: Edge | undefined = edge.nextDep;

    if (edge.type === EdgeType.Promise) {
      edge.prevDep = lastKept;
      edge.nextDep = undefined;

      if (lastKept !== undefined) {
        lastKept.nextDep = edge;
      } else {
        consumer.depsHead = edge;
      }

      lastKept = edge;
      edge = next;
      continue;
    }

    const dep = edge.dep;
    unwatchSignal(dep);
    unlinkSub(dep, edge);

    edge.nextDep = undefined;
    edge.prevDep = undefined;
    edge.sub = undefined;

    if (dep._state < ReactiveFnState.Dirty) {
      dep._state = ReactiveFnState.Dirty;
    }

    edge = next;
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
