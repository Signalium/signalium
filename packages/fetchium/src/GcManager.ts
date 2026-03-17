/**
 * GcManager — bucket-based in-memory garbage collection.
 *
 * Each unique `gcTime` value (in minutes) gets its own interval with two
 * rotating sets (`currentFlush` / `nextFlush`). When `schedule(key, gcTime)`
 * is called the key is added to `nextFlush`. On the next tick of that
 * bucket's interval the set rotates, so the key lands in `currentFlush` and
 * is evicted on the *following* tick. This means:
 *
 *   minimum eviction delay  ≈  gcTime
 *   maximum eviction delay  ≈  2 × gcTime
 *
 * Special values:
 *   gcTime === 0        → evict on the next microtask (setTimeout(0))
 *   gcTime === Infinity  → never evict
 */

export const enum GcKeyType {
  Query = 0,
  Entity = 1,
}

class GcBucket {
  private _currentFlush = new Map<number, GcKeyType>();
  private _nextFlush = new Map<number, GcKeyType>();
  private _intervalId: ReturnType<typeof setInterval>;

  constructor(
    gcTimeMinutes: number,
    private _onEvict: (key: number, type: GcKeyType) => void,
    multiplier: number,
  ) {
    this._intervalId = setInterval(this._tick, gcTimeMinutes * 60_000 * multiplier);
  }

  schedule(key: number, type: GcKeyType): void {
    this._nextFlush.set(key, type);
  }

  cancel(key: number): void {
    this._currentFlush.delete(key);
    this._nextFlush.delete(key);
  }

  private _tick = (): void => {
    const { _currentFlush, _nextFlush, _onEvict } = this;
    for (const [key, type] of _currentFlush) {
      _onEvict(key, type);
    }
    this._currentFlush = _nextFlush;
    this._nextFlush = new Map();
  };

  destroy(): void {
    clearInterval(this._intervalId);
  }
}

export class GcManager {
  private _buckets = new Map<number, GcBucket>();
  private _nextTickEntries = new Map<number, GcKeyType>();
  private _nextTickScheduled = false;
  private _onEvict: (key: number, type: GcKeyType) => void;
  private _multiplier: number;

  constructor(onEvict: (key: number, type: GcKeyType) => void, multiplier: number = 1) {
    this._onEvict = onEvict;
    this._multiplier = multiplier;
  }

  schedule(key: number, gcTime: number, type: GcKeyType): void {
    if (gcTime === Infinity) return;

    if (gcTime === 0) {
      const { _nextTickEntries } = this;
      _nextTickEntries.set(key, type);
      if (!this._nextTickScheduled) {
        this._nextTickScheduled = true;
        setTimeout(this._flushNextTick, 0);
      }
      return;
    }

    const { _buckets } = this;
    let bucket = _buckets.get(gcTime);
    if (!bucket) {
      bucket = new GcBucket(gcTime, this._onEvict, this._multiplier);
      _buckets.set(gcTime, bucket);
    }
    bucket.schedule(key, type);
  }

  cancel(key: number, gcTime: number): void {
    if (gcTime === Infinity) return;

    if (gcTime === 0) {
      this._nextTickEntries.delete(key);
      return;
    }

    this._buckets.get(gcTime)?.cancel(key);
  }

  private _flushNextTick = (): void => {
    const { _nextTickEntries, _onEvict } = this;
    this._nextTickScheduled = false;
    for (const [key, type] of _nextTickEntries) {
      _onEvict(key, type);
    }
    _nextTickEntries.clear();
  };

  destroy(): void {
    const { _buckets, _nextTickEntries } = this;
    for (const bucket of _buckets.values()) {
      bucket.destroy();
    }
    _buckets.clear();
    _nextTickEntries.clear();
  }
}

export class NoOpGcManager {
  schedule(_key: number, _gcTime: number, _type: GcKeyType): void {}
  cancel(_key: number, _gcTime: number): void {}
  destroy(): void {}
}
