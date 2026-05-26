import { scheduleAsyncPull, schedulePull } from './scheduling.js';
import { ReactiveSignal, isRelay, ReactiveFnState } from './reactive.js';
import { getCurrentConsumer, type ReactiveConsumer } from './consumer.js';
import { Edge, unlinkSub } from './edge.js';
import { Effect } from './effect.js';

export function dirtySignal(signal: ReactiveConsumer) {
  const prevState = signal._state;

  if (prevState === ReactiveFnState.Dirty) {
    return;
  }

  signal._state = ReactiveFnState.Dirty;

  if (prevState < ReactiveFnState.MaybeDirty) {
    propagateDirty(signal);
  }
}

function propagateDirty(signal: ReactiveConsumer) {
  if (getCurrentConsumer() === signal) {
    throw new Error(
      'A signal was dirtied after it was consumed by the current function. This can cause race conditions and infinite rerenders and is not allowed.',
    );
  }

  if (signal instanceof Effect) {
    // Effects are leaves: nothing depends on them, so there are no
    // subscribers to walk. They're also self-watched (watchCount > 0 by
    // construction), so this is just a schedulePull when active. No
    // relay/dirtySignalConsumers bookkeeping needed.
    //
    // Called from `dirtySignal(effect)` when state goes Clean->Dirty, i.e.
    // a state signal that the effect depends on directly has actually
    // changed. No validation walk is needed in that case — the effect must
    // re-run.
    if (signal._isListener) {
      schedulePull(signal);
    }
    return;
  }

  if (isRelay(signal)) {
    if (signal.watchCount > 0) {
      scheduleAsyncPull(signal);
    }

    // else do nothing, only schedule if connected
  } else {
    if (signal._isListener && signal.watchCount > 0) {
      schedulePull(signal);
    }

    dirtySignalConsumers(signal);
  }
}

export function dirtySignalConsumers(signal: ReactiveSignal<any, any>) {
  let edge = signal.subsHead;

  while (edge !== undefined) {
    const nextSub = edge.nextSub;
    const sub = edge.sub;

    if (sub === undefined || sub.computedCount !== edge.consumedAt) {
      unlinkSub(signal, edge);
      edge = nextSub;
      continue;
    }

    dirtyConsumerEdge(sub, edge);
    edge = nextSub;
  }
}

export function dirtyPromiseConsumers(map: Map<WeakRef<ReactiveConsumer>, Edge>) {
  for (const [subRef, edge] of map) {
    const sub = subRef.deref();

    if (sub === undefined || sub.computedCount !== edge.consumedAt) {
      map.delete(subRef);
      continue;
    }

    dirtyConsumerEdge(sub, edge);
  }
}

function dirtyConsumerEdge(sub: ReactiveConsumer, edge: Edge) {
  const dirtyEpoch = sub.dirtyEpoch;
  if (edge.dirtyAt === dirtyEpoch) {
    return;
  }

  edge.dirtyAt = dirtyEpoch;

  const dirtyState = sub._state;

  switch (dirtyState) {
    case ReactiveFnState.Clean:
      sub._state = ReactiveFnState.MaybeDirty;
      sub.dirtyHead = edge;
      edge.nextDirty = undefined;
      if (sub instanceof Effect) {
        // Effects have no subscribers to walk and aren't relays — skip
        // `propagateDirty` entirely and just enqueue the pull. The dirty
        // edge is still recorded in `dirtyHead` so `checkAndRunEffect` can
        // validate before re-running (same MaybeDirty -> Dirty? walk that
        // memos do).
        if (sub._isListener) {
          schedulePull(sub);
        }
      } else {
        propagateDirty(sub);
      }
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
          // (Effects never enter Pending/PendingDirty — they have no async path.)
          sub._state = ReactiveFnState.MaybeDirty;
          propagateDirty(sub);
        }
      } else {
        let nextDirty = subEdge.nextDirty;

        while (nextDirty !== undefined && nextDirty.ord < ord) {
          subEdge = nextDirty;
          nextDirty = subEdge.nextDirty;
        }

        if (IS_DEV && edge === nextDirty) {
          throw new Error('Edge already inserted, this should not happen. Please open an issue on GitHub.');
        }

        edge.nextDirty = nextDirty;
        subEdge!.nextDirty = edge;
      }
      break;
    }
  }
}
