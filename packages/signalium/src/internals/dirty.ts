import { scheduleAsyncPull, schedulePull } from './scheduling.js';
import { ReactiveFnSignal, isRelay, ReactiveFnState } from './reactive.js';
import { CURRENT_CONSUMER } from './consumer.js';
import { Edge } from './edge.js';

export function dirtySignal(signal: ReactiveFnSignal<any, any>) {
  const prevState = signal._state;

  if (prevState === ReactiveFnState.Dirty) {
    return;
  }

  signal._state = ReactiveFnState.Dirty;

  if (prevState < ReactiveFnState.MaybeDirty) {
    propagateDirty(signal);
  }
}

function propagateDirty(signal: ReactiveFnSignal<any, any>) {
  if (CURRENT_CONSUMER === signal) {
    throw new Error(
      'A signal was dirtied after it was consumed by the current function. This can cause race conditions and infinite rerenders and is not allowed.',
    );
  }

  if (isRelay(signal)) {
    if (signal.watchCount > 0) {
      scheduleAsyncPull(signal);
    }

    // else do nothing, only schedule if connected
  } else {
    if (signal._isListener) {
      schedulePull(signal);
    }

    dirtySignalConsumers(signal.subs);
    signal.subs = new Map();
  }
}

export function dirtySignalConsumers(map: Map<WeakRef<ReactiveFnSignal<any, any>>, Edge>) {
  for (const [subRef, edge] of map) {
    const sub = subRef.deref();

    if (sub === undefined || sub.computedCount !== edge.consumedAt) continue;

    const dirtyState = sub._state;

    switch (dirtyState) {
      case ReactiveFnState.Clean:
        sub._state = ReactiveFnState.MaybeDirty;
        sub.dirtyHead = edge;
        edge.nextDirty = undefined;
        propagateDirty(sub);
        break;

      case ReactiveFnState.Pending:
      case ReactiveFnState.MaybeDirty:
      case ReactiveFnState.PendingDirty: {
        let subEdge = sub.dirtyHead!;
        const ord = edge.ord;

        if (subEdge.ord > ord) {
          sub.dirtyHead = edge;
          edge.nextDirty = subEdge;

          if (dirtyState === ReactiveFnState.Pending || dirtyState === ReactiveFnState.PendingDirty) {
            // If the signal is pending, the first edge is the halt edge. If the
            // new dirty edge is BEFORE the halt edge, then it means that something
            // changed before the current halt, so we need to cancel the current computation
            // and recompute.
            sub._state = ReactiveFnState.MaybeDirty;
            propagateDirty(sub);
          }
        } else {
          let nextDirty = subEdge.nextDirty;

          while (nextDirty !== undefined && nextDirty.ord < ord) {
            subEdge = nextDirty;
            nextDirty = subEdge.nextDirty;
          }

          edge.nextDirty = nextDirty;
          subEdge!.nextDirty = edge;
        }
        break;
      }
    }
  }
}
