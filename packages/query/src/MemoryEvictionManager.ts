import { type QueryClient } from './QueryClient.js';

const EVICTION_INTERVAL = 60 * 1000; // 1 minute

// Memory eviction manager - uses a single interval with rotating sets to avoid timeout overhead
export class MemoryEvictionManager {
  private intervalId: NodeJS.Timeout;
  private currentFlush = new Set<number>(); // Queries to evict on next tick
  private nextFlush = new Set<number>(); // Queries to evict on tick after next

  constructor(
    private queryClient: QueryClient,
    private multiplier: number = 1,
  ) {
    this.intervalId = setInterval(this.tick, EVICTION_INTERVAL * this.multiplier);
  }

  scheduleEviction(queryKey: number) {
    // Add to nextFlush so it waits at least one full interval
    // This prevents immediate eviction if scheduled right before a tick
    this.nextFlush.add(queryKey);
  }

  cancelEviction(queryKey: number) {
    // Remove from both sets to handle reactivation
    this.currentFlush.delete(queryKey);
    this.nextFlush.delete(queryKey);
  }

  private tick = () => {
    if (!this.queryClient) return;

    // Evict all queries in currentFlush
    for (const queryKey of this.currentFlush) {
      this.queryClient.queryInstances.delete(queryKey);
    }

    // Rotate: currentFlush becomes nextFlush, nextFlush becomes empty
    this.currentFlush = this.nextFlush;
    this.nextFlush = new Set();
  };

  destroy(): void {
    clearInterval(this.intervalId);
  }
}

// No-op implementation for SSR environments where timers are not needed
export class NoOpMemoryEvictionManager {
  scheduleEviction(_queryKey: number): void {
    // No-op: do nothing
  }

  cancelEviction(_queryKey: number): void {
    // No-op: do nothing
  }

  destroy(): void {
    // No-op: do nothing
  }
}
