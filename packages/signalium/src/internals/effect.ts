import { ReactiveFnState, ReactiveFnFlags, ReactiveSignal } from './reactive.js';
import { Edge, EdgeType, linkSub, unlinkDep, unlinkSub } from './edge.js';
import { getCurrentConsumer, setCurrentConsumer } from './consumer.js';
import { cancelPull } from './scheduling.js';
import { checkSignal, disconnectSignal } from './get.js';
import { unwatchSignal } from './watch.js';
import type { SignalScope } from './contexts.js';
import type { TracerMeta } from './trace.js';
import type { Callback } from './callback.js';

let EFFECT_ID = 0;

/**
 * A slim, autorun primitive that participates in the same dependency graph as
 * `ReactiveSignal` but skips all of the memo/value/subscriber/listener
 * plumbing. Effects are leaves: they consume signals and re-run when those
 * signals change, but nothing depends on them, and they have no cached value.
 *
 * Field set is intentionally a strict subset of `ReactiveSignal`'s — exactly
 * the fields touched by the dep-graph (`edge.ts`), dirty propagation
 * (`dirty.ts`), the pull queue (`scheduling.ts`), and the consumer-side of
 * `getSignal`. We rely on structural compatibility (and a few `as any` casts
 * at the boundaries) so the existing helpers can operate on either type
 * without an extra layer of polymorphism.
 */
export class Effect {
  // Bitmask containing state in the low bits and boolean properties in the
  // remaining bits. Mirrors `ReactiveSignal.flags` so the existing bitfield
  // helpers and dispatch sites work for both.
  flags: number;
  scope: SignalScope | undefined = undefined;

  depsHead: Edge | undefined = undefined;
  depsTail: Edge | undefined = undefined;

  dirtyHead: Edge | undefined = undefined;
  dirtyEpoch: number = 0;
  nextPull: ReactiveSignal<any, any> | Effect | undefined = undefined;
  prevPull: ReactiveSignal<any, any> | Effect | undefined = undefined;

  updatedCount: number = 0;
  computedCount: number = 0;

  // Effects are self-watched: they're always considered "live" between
  // creation and dispose. This makes `propagateDirty` schedule them via the
  // existing `_isListener && watchCount > 0` gate without any special-casing.
  watchCount: number = 1;

  // The autorun closure. No `def` indirection; effects don't memoize and
  // don't share configuration across instances.
  fn: () => void;

  // Dev-only tracer metadata. Declared as optional so type-only consumers
  // (e.g. `currentConsumer.tracerMeta!.id` in `getSignal`'s tracer path) can
  // see it. Only populated when `IS_DEV` is true.
  tracerMeta?: TracerMeta;

  // Per-effect callback memoization slots, populated lazily by `callback()`
  // when invoked from an effect body. Effects that never call `callback()`
  // pay nothing beyond the declared (undefined) slot.
  callbacks: Callback[] | undefined = undefined;

  // Lazily allocated WeakRef. `getSignal` reads `currentConsumer.ref` to pass
  // into edge construction, but that subRef only matters in the async/promise
  // path — for the synchronous signal-edge case it's an unused passenger.
  // We keep it lazy to avoid a per-Effect WeakRef allocation in the common
  // case.
  private _ref: WeakRef<Effect> | undefined = undefined;

  constructor(fn: () => void, scope: SignalScope | undefined) {
    // Initial state: `Dirty` so the first run is unconditional.
    // `isListener` so `propagateDirty` schedules us via `schedulePull`.
    // `isActive` is the on/off switch toggled by `disposeEffect`.
    this.flags = ReactiveFnState.Dirty | ReactiveFnFlags.isListener | ReactiveFnFlags.isActive;
    this.scope = scope;
    this.fn = fn;

    if (IS_DEV) {
      const id = ++EFFECT_ID;
      (this as any).id = id;
      // Minimal tracerMeta so any dev-tracer paths that read it (via the
      // `tracerMeta!.id` non-null assertion) don't trip when the current
      // consumer is an Effect.
      this.tracerMeta = {
        id,
        desc: 'effect',
        params: '',
        tracer: undefined,
      };
    }
  }

  get _state(): ReactiveFnState {
    return this.flags & ReactiveFnFlags.State;
  }

  set _state(state: ReactiveFnState) {
    this.flags = (this.flags & ~ReactiveFnFlags.State) | state;
  }

  get _isListener(): boolean {
    return (this.flags & ReactiveFnFlags.isListener) !== 0;
  }

  get _isActive(): boolean {
    return (this.flags & ReactiveFnFlags.isActive) !== 0;
  }

  get _isPullQueued(): boolean {
    return (this.flags & ReactiveFnFlags.isPullQueued) !== 0;
  }

  set _isPullQueued(isQueued: boolean) {
    if (isQueued) {
      this.flags |= ReactiveFnFlags.isPullQueued;
    } else {
      this.flags &= ~ReactiveFnFlags.isPullQueued;
    }
  }

  get ref(): WeakRef<Effect> {
    return this._ref ?? (this._ref = new WeakRef(this));
  }
}

/**
 * Run an effect: capture deps via the standard `CURRENT_CONSUMER` machinery,
 * then disconnect any deps that were active in the previous run but weren't
 * read this time. Analogous to `runSignal` but stripped of value caching,
 * equality checks, async/promise unwrapping, and arg spread.
 *
 * Always leaves state at `Clean` and bumps `dirtyEpoch` so further dirty
 * propagation through this effect's edges is correctly de-duped.
 */
export function runEffect(e: Effect): void {
  if (!e._isActive) return;

  const prevConsumer = getCurrentConsumer();
  const computedCount = ++e.computedCount;

  try {
    e.depsTail = undefined;
    setCurrentConsumer(e as any);
    e.fn();
    disconnectSignal(e);
  } finally {
    setCurrentConsumer(prevConsumer);
  }

  e.updatedCount++;
  e._state = ReactiveFnState.Clean;
  e.dirtyHead = undefined;
  e.dirtyEpoch++;
}

/**
 * Pull-queue handler for effects. Walks the `dirtyHead` linked list in the
 * `MaybeDirty` state to validate that at least one dep's `updatedCount`
 * actually bumped before re-running. This matches the short-circuit
 * semantics of memos: if every dep is a memo whose value didn't change, the
 * effect body does NOT re-run.
 *
 * State machine:
 *   - `Dirty`: a state signal that's a direct dep notified us (state signals
 *     already filter via their equals check before calling `notify`). We
 *     re-run unconditionally.
 *   - `MaybeDirty` (or `PendingDirty`): one or more upstream memos ticked.
 *     Validate via `checkSignal(dep)` per dirty edge; flip to `Dirty` on the
 *     first edge whose `updatedAt` changed; otherwise stay `MaybeDirty` and
 *     skip the run.
 *   - Anything else (`Clean` after a race with dispose, etc.): just clear
 *     the bookkeeping and bail.
 *
 * Disposed effects are skipped — `_isActive` short-circuits before any work.
 */
export function checkAndRunEffect(e: Effect): void {
  if (!e._isActive) {
    e._state = ReactiveFnState.Clean;
    e.dirtyHead = undefined;
    e.dirtyEpoch++;
    return;
  }

  // MaybeDirty validation walk. `>= MaybeDirty` covers MaybeDirty and the
  // PendingDirty variant; both indicate "an upstream memo dep ticked but we
  // haven't confirmed a real change yet".
  if (e._state >= ReactiveFnState.MaybeDirty) {
    let edge: Edge | undefined = e.dirtyHead;
    while (edge !== undefined) {
      if (edge.type === EdgeType.Promise) {
        // Effects don't `await`. Defensive: skip promise edges instead of
        // attempting an unwrap/halt path.
        edge = edge.nextDirty;
        continue;
      }
      const dep = edge.dep;
      const updatedAt = checkSignal(dep);
      // Mirror `checkSignal`'s MaybeDirty walk: re-link the edge into the
      // dep's subsHead in case it got unlinked during the recursive validation.
      linkSub(dep, edge);
      if (edge.updatedAt !== updatedAt) {
        e._state = ReactiveFnState.Dirty;
        break;
      }
      edge = edge.nextDirty;
    }
  }

  if (e._state === ReactiveFnState.Dirty) {
    runEffect(e);
  } else {
    e._state = ReactiveFnState.Clean;
    e.dirtyHead = undefined;
    e.dirtyEpoch++;
  }
}

/**
 * Tear down an effect. Walks its current dep edges, unwatches each dep, and
 * unlinks the edges from both sides of the graph. Idempotent — re-disposing
 * is a no-op once `_isActive` is cleared.
 */
export function disposeEffect(e: Effect): void {
  if (!e._isActive) return;

  // Clear active first so any in-flight dirty propagation that's racing with
  // dispose treats this effect as cancelled.
  e.flags &= ~ReactiveFnFlags.isActive;
  e.flags &= ~ReactiveFnFlags.isListener;

  cancelPull(e);

  let edge = e.depsHead;
  while (edge !== undefined) {
    const next = edge.nextDep;
    if (edge.type === EdgeType.Signal) {
      const dep = edge.dep;
      unwatchSignal(dep);
      unlinkSub(dep, edge);
      unlinkDep(e as any, edge);
    }
    edge = next;
  }

  e.depsHead = undefined;
  e.depsTail = undefined;
  e.watchCount = 0;
  e._state = ReactiveFnState.Clean;
}
