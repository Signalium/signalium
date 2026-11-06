export const MIN_PRUNE_SIZE = 64;

/**
 * Sets a subscriber entry and returns the size at which to next prune collected subscribers. Pass
 * back what the previous call returned.
 */
export function setSub<V>(subs: Map<WeakRef<object>, V>, ref: WeakRef<object>, value: V, pruneAt: number): number {
  subs.set(ref, value);
  if (subs.size < pruneAt) return pruneAt;

  // A long-lived dependency is cleared only when it notifies, so without this its map keeps one
  // entry per consumer it ever had.
  for (const key of subs.keys()) {
    if (key.deref() === undefined) subs.delete(key);
  }

  // Twice the survivors: a map that hovers at a fixed size would otherwise rescan on every insert.
  return Math.max(MIN_PRUNE_SIZE, subs.size * 2);
}
