/**
 * LRU Queue with Active/Inactive Segments
 *
 * Queue structure: [...activeItems..., ...inactiveItems..., 0, 0, ...]
 * - Indices 0 to activeCount-1: Active items (most recent at index 0)
 * - Indices activeCount onwards: Inactive items (most recent at activeCount)
 * - activeCount is runtime-only state (not persisted)
 * - Unused slots contain 0
 *
 * On app restart, activeCount resets to 0, so everything becomes inactive.
 */

export class LRUQueue {
  public queue: Uint32Array;
  private activeCount: number = 0;

  constructor(capacity: number, initialQueue?: Uint32Array) {
    if (initialQueue) {
      this.queue = initialQueue;
      // When loading from disk, activeCount starts at 0 (all inactive)
    } else {
      this.queue = new Uint32Array(capacity);
    }
  }

  /**
   * Activates a key (adds to or moves to front of active segment)
   * Returns information about any eviction that occurred
   */
  activate(key: number, growthFactor = 1.5): number | null {
    let queue = this.queue;
    const activeCount = this.activeCount;
    const indexOfQuery = queue.indexOf(key);

    // 1️⃣ Item already exists in the queue
    if (indexOfQuery >= 0) {
      // Check if it's in the active segment
      if (indexOfQuery < activeCount) {
        // Already in active segment
        if (indexOfQuery === 0) {
          // Already at front of active segment, nothing to do
          return null;
        }
        // Move to front of active segment
        queue.copyWithin(1, 0, indexOfQuery);
        queue[0] = key;
      } else {
        // In inactive segment, move to front of active segment
        const itemValue = queue[indexOfQuery];

        // Shift everything from [0, indexOfQuery) right by one
        // This moves the active segment right and closes the gap where item was
        queue.copyWithin(1, 0, indexOfQuery);
        queue[0] = itemValue;

        // Increment active count
        this.activeCount++;
      }

      return null;
    }

    // 2️⃣ Item not found, need to add it to the front of active segment
    let capacity = queue.length;

    if (activeCount === capacity) {
      // No inactive items to evict, grow the queue
      queue = this.grow(growthFactor);
      capacity = queue.length;
    }

    // Shift entire array right and check if last item needs eviction
    const lastItem = queue[capacity - 1];
    queue.copyWithin(1, 0, capacity - 1);

    queue[0] = key;
    this.activeCount++;

    return lastItem === 0 ? null : lastItem;
  }

  /**
   * Deactivates a key (moves from active to inactive segment)
   * Returns true if the key was found and deactivated
   */
  deactivate(key: number): boolean {
    const queue = this.queue;
    const activeCount = this.activeCount;

    const indexOfQuery = queue.indexOf(key);

    // If not in queue or already in inactive segment, nothing to do
    if (indexOfQuery < 0 || indexOfQuery >= activeCount) {
      return false;
    }

    // Move from active segment to front of inactive segment
    const itemValue = queue[indexOfQuery];

    // Remove from active segment by shifting items left
    queue.copyWithin(indexOfQuery, indexOfQuery + 1, activeCount);

    // Insert at front of inactive segment (which is now at activeCount - 1)
    queue[activeCount - 1] = itemValue;

    // Decrement active count
    this.activeCount--;

    return true;
  }

  /**
   * Grows the queue capacity
   */
  private grow(growthFactor: number): Uint32Array {
    const queue = this.queue;
    const oldCapacity = queue.length;
    const newCapacity = Math.ceil(oldCapacity * growthFactor);
    const newQueue = new Uint32Array(newCapacity);

    // Copy all data from the old queue
    newQueue.set(queue);

    this.queue = newQueue;

    return newQueue;
  }
}
