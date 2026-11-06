export const MIN_PRUNE_SIZE = 64;

/** Deletes subscribers whose consumer was collected and returns the size at which to prune next. */
export function pruneSubs(subs: Map<WeakRef<object>, unknown>): number {
  // A long-lived dependency is cleared only when it notifies, so without this its map keeps one
  // entry per consumer it ever had.
  for (const key of subs.keys()) {
    if (key.deref() === undefined) subs.delete(key);
  }

  // Twice the survivors: a map that hovers at a fixed size would otherwise rescan on every insert.
  return Math.max(MIN_PRUNE_SIZE, subs.size * 2);
}
