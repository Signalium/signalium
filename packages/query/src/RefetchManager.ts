import { QueryType, type QueryCacheOptions } from './QueryClient.js';
import type { QueryResultImpl } from './QueryResult.js';

const BASE_TICK_INTERVAL = 1000; // 1 second

// Refetch interval manager - uses a fixed 1-second tick
export class RefetchManager {
  private intervalId: NodeJS.Timeout;
  private clock: number = 0; // Increments by 1000ms on each tick

  // Buckets: Map of actual interval -> Set of query instances (static intervals only)
  private buckets = new Map<number, Set<QueryResultImpl<any>>>();

  // Queries with dynamic (function) refetchInterval, evaluated every tick
  private dynamicQueries = new Set<QueryResultImpl<any>>();

  constructor(private multiplier: number = 1) {
    // Start the timer immediately and keep it running
    const tickInterval = BASE_TICK_INTERVAL * this.multiplier;
    this.intervalId = setTimeout(() => this.tick(), tickInterval);
  }

  addQuery(instance: QueryResultImpl<any>) {
    if (instance.def.type === QueryType.Stream) {
      return; // Streams don't have refetch intervals
    }

    const refetchInterval = instance.def.cache?.refetchInterval;

    if (!refetchInterval) {
      return;
    }

    if (typeof refetchInterval === 'function') {
      this.dynamicQueries.add(instance);
      return;
    }

    const actualInterval = refetchInterval * this.multiplier;
    // Add to bucket by actual interval
    let bucket = this.buckets.get(actualInterval);
    if (!bucket) {
      bucket = new Set();
      this.buckets.set(actualInterval, bucket);
    }
    bucket.add(instance);
  }

  removeQuery(query: QueryResultImpl<any>) {
    if (query.def.type === QueryType.Stream) {
      return; // Streams don't have refetch intervals
    }

    const refetchInterval = query.def.cache?.refetchInterval;

    if (!refetchInterval) {
      return;
    }

    if (typeof refetchInterval === 'function') {
      this.dynamicQueries.delete(query);
      return;
    }

    const actualInterval = refetchInterval * this.multiplier;
    // Remove from bucket
    const bucket = this.buckets.get(actualInterval);
    if (bucket) {
      bucket.delete(query);

      if (bucket.size === 0) {
        this.buckets.delete(actualInterval);
      }
    }
  }

  private tick() {
    this.clock += BASE_TICK_INTERVAL * this.multiplier;

    // Process static-interval buckets where clock is aligned with the interval
    for (const [interval, bucket] of this.buckets.entries()) {
      if (this.clock % interval === 0) {
        // Process all queries in this bucket
        for (const query of bucket) {
          // Skip if already fetching - let the current fetch complete
          if (query && !query.isFetching) {
            query.refetch();
          }
        }
      }
    }

    // Process dynamic-interval queries
    for (const query of this.dynamicQueries) {
      if (query.isFetching) continue;

      const fn = (query.def.cache as QueryCacheOptions | undefined)?.refetchInterval;
      if (typeof fn !== 'function') continue;

      const interval = fn({ isRejected: query.isRejected, error: query.error });

      if (interval === false || !interval) continue;

      const actualInterval = interval * this.multiplier;
      if (this.clock % actualInterval === 0) {
        query.refetch();
      }
    }

    const tickInterval = BASE_TICK_INTERVAL * this.multiplier;
    this.intervalId = setTimeout(() => this.tick(), tickInterval);
  }

  destroy(): void {
    clearTimeout(this.intervalId);
  }
}

// No-op implementation for SSR environments where timers are not needed
export class NoOpRefetchManager {
  addQuery(_instance: QueryResultImpl<any>): void {
    // No-op: do nothing
  }

  removeQuery(_query: QueryResultImpl<any>): void {
    // No-op: do nothing
  }

  destroy(): void {
    // No-op: do nothing
  }
}
