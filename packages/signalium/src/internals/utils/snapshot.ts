import { isReactivePromise, ReactivePromiseImpl } from '../async.js';

export type SnapshotFn = (current: unknown, prev: unknown) => unknown;

type SnapshotHandler = (current: any, prev: any, snap: SnapshotFn) => any;

const getProto = Object.getPrototypeOf;

function snapshotArray(current: unknown[], prev: unknown, snap: SnapshotFn): unknown[] {
  const prevArr = Array.isArray(prev) ? prev : undefined;
  let changed = !prevArr || prevArr.length !== current.length;

  const result = new Array(current.length);
  for (let i = 0; i < current.length; i++) {
    result[i] = snap(current[i], prevArr?.[i]);
    if (!changed && result[i] !== prevArr![i]) {
      changed = true;
    }
  }

  return changed ? result : prevArr!;
}

function snapshotPlainObject(
  current: Record<string, unknown>,
  prev: unknown,
  snap: SnapshotFn,
): Record<string, unknown> {
  const prevObj =
    prev !== null && prev !== undefined && typeof prev === 'object' && !Array.isArray(prev)
      ? (prev as Record<string, unknown>)
      : undefined;

  const keys = Object.keys(current);
  let changed = !prevObj || Object.keys(prevObj).length !== keys.length;

  const result: Record<string, unknown> = {};
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    result[key] = snap(current[key], prevObj?.[key]);
    if (!changed && result[key] !== prevObj![key]) {
      changed = true;
    }
  }

  return changed ? result : prevObj!;
}

function snapshotReactivePromise(current: ReactivePromiseImpl<unknown>, prev: unknown, snap: SnapshotFn): unknown {
  const prevObj =
    prev !== null && prev !== undefined && typeof prev === 'object' ? (prev as Record<string, unknown>) : undefined;

  const value = snap(current.value, prevObj?.value);
  const error = current.error;
  const isPending = current.isPending;
  const isRejected = current.isRejected;
  const isResolved = current.isResolved;
  const isReady = current.isReady;
  const isSettled = current.isSettled;

  if (
    prevObj &&
    value === prevObj.value &&
    error === prevObj.error &&
    isPending === prevObj.isPending &&
    isRejected === prevObj.isRejected &&
    isResolved === prevObj.isResolved &&
    isReady === prevObj.isReady &&
    isSettled === prevObj.isSettled
  ) {
    return prevObj;
  }

  return { value, error, isPending, isRejected, isResolved, isReady, isSettled };
}

function snapshotMap(current: Map<unknown, unknown>, prev: unknown, snap: SnapshotFn): Map<unknown, unknown> {
  const prevMap = prev instanceof Map ? prev : undefined;
  let changed = !prevMap || prevMap.size !== current.size;

  const result = new Map();
  for (const [key, val] of current) {
    const snapped = snap(val, prevMap?.get(key));
    result.set(key, snapped);
    if (!changed && snapped !== prevMap!.get(key)) {
      changed = true;
    }
  }

  return changed ? result : prevMap!;
}

function snapshotSet(current: Set<unknown>, prev: unknown, _snap: SnapshotFn): Set<unknown> {
  const prevSet = prev instanceof Set ? prev : undefined;
  let changed = !prevSet || prevSet.size !== current.size;

  const result = new Set();
  for (const val of current) {
    const snapped = snapshot(val, prevSet?.has(val) ? val : undefined);
    result.add(snapped);
    if (!changed && !prevSet!.has(snapped)) {
      changed = true;
    }
  }

  return changed ? result : prevSet!;
}
/**
 * Built-in handlers for plain structural types. Matched by exact prototype
 * only — subclasses of `Object` / `Array` / `Map` / `Set` are NOT routed
 * through these handlers (they fall through and, if no custom ancestor is
 * registered, are returned as-is). We use a Map here rather than installing
 * a symbol property on the built-in prototypes, because mutating built-in
 * prototypes (even with a symbol key) changes their hidden class and
 * invalidates V8's fast-path inline caches for every plain object / array
 * in the program.
 */
const BUILTIN_PROTO_TO_SNAPSHOT = new Map<object | null, SnapshotHandler>([
  [Object.prototype, snapshotPlainObject],
  [Array.prototype, snapshotArray],
  [Map.prototype, snapshotMap],
  [Set.prototype, snapshotSet],
  [null, snapshotPlainObject],
]);

/**
 * Custom registrations are stored as a non-enumerable symbol property on the
 * class prototype. JS prototype lookup walks the chain natively, so subclass
 * inheritance and override-by-redefinition are free — no resolver, no cache,
 * no invalidation. The symbol is module-private (created with `Symbol()`,
 * not `Symbol.for()`), so it cannot collide with anything else and cannot
 * be addressed by user code.
 */
const SNAPSHOT_HANDLER = Symbol('signalium.snapshot.handler');

interface MaybeSnapshottable {
  [SNAPSHOT_HANDLER]?: SnapshotHandler;
}

/**
 * Register a custom snapshot function for instances of a class.
 * The function receives the current value, the previous snapshot (or undefined),
 * and the recursive `snapshot` function for snapshotting nested values.
 *
 * Subclasses inherit the handler automatically via prototype lookup, so
 * registering once on a base class applies to all descendants. A descendant
 * can override by registering its own handler.
 *
 * Return `prev` when nothing has changed to preserve reference stability.
 *
 * @example
 * ```ts
 * registerCustomSnapshot(MyEntity, (current, prev, snapshot) => {
 *   const name = snapshot(current.name, prev?.name);
 *   const age = current.age;
 *   if (prev && name === prev.name && age === prev.age) return prev;
 *   return { name, age };
 * });
 * ```
 */
export const registerCustomSnapshot = <T extends object>(
  ctor: new (...args: any[]) => T,
  snapshotFn: (current: T, prev: T | undefined, snapshot: SnapshotFn) => T,
): void => {
  // Use defineProperty so the handler is non-enumerable (it shouldn't show up
  // in `Reflect.ownKeys` walks any more than necessary) and so re-registration
  // overwrites cleanly even if a subclass has shadowed it.
  Object.defineProperty(ctor.prototype, SNAPSHOT_HANDLER, {
    value: snapshotFn as SnapshotHandler,
    writable: true,
    configurable: true,
    enumerable: false,
  });
};

/**
 * Recursively snapshot a value with structural sharing.
 *
 * - Plain objects and arrays are deep-cloned; unchanged subtrees keep the same reference.
 * - ReactivePromise instances are read (establishing deps) and flattened to a plain object.
 * - Class instances are returned as-is unless a custom handler is registered
 *   for the class or any of its ancestors via `registerCustomSnapshot`.
 * - Primitives are returned directly.
 */
export function snapshot(currentValue: unknown, prevValue: unknown): unknown {
  if (currentValue === null || typeof currentValue !== 'object') {
    return currentValue;
  }

  if (isReactivePromise(currentValue)) {
    return snapshotReactivePromise(currentValue as ReactivePromiseImpl<unknown>, prevValue, snapshot);
  }

  // Custom registrations check first: native prototype lookup walks the chain
  // for us, so subclasses inherit their ancestor's handler with no extra work.
  const customHandler = (currentValue as MaybeSnapshottable)[SNAPSHOT_HANDLER];
  if (customHandler !== undefined) {
    return customHandler(currentValue, prevValue, snapshot);
  }

  // Built-in handlers are looked up by exact prototype only.
  const builtIn = BUILTIN_PROTO_TO_SNAPSHOT.get(getProto(currentValue));
  if (builtIn !== undefined) {
    return builtIn(currentValue, prevValue, snapshot);
  }

  return currentValue;
}
