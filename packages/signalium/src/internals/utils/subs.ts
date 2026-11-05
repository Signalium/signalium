const MIN_PRUNE_SIZE = 64;

/**
 * Sets a subscriber entry. Each time a new key brings the map to a power of two of at least 64,
 * deletes subscribers whose consumer was collected.
 */
export function setSub<V>(subs: Map<WeakRef<object>, V>, ref: WeakRef<object>, value: V): void {
  const size = subs.size;
  subs.set(ref, value);
  const next = subs.size;

  // A long-lived dependency is cleared only when it notifies, so without this its map keeps one
  // entry per consumer it ever had.
  if (next !== size && next >= MIN_PRUNE_SIZE && (next & (next - 1)) === 0) {
    for (const key of subs.keys()) {
      if (key.deref() === undefined) subs.delete(key);
    }
  }
}
