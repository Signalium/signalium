import type { MutationEvent } from '../types.js';

const MIN_INTERVAL = 100;

export interface PollConfig {
  interval: number;
}

function clampInterval(interval: number): number {
  if (!Number.isFinite(interval) || interval < MIN_INTERVAL) {
    if (IS_DEV && (Number.isNaN(interval) || interval < 0)) {
      console.warn(`poll: invalid interval ${interval}, clamping to ${MIN_INTERVAL}ms`);
    }
    return MIN_INTERVAL;
  }
  return interval;
}

export function poll(config: PollConfig): (this: any, onEvent: (event: MutationEvent) => void) => () => void {
  const interval = clampInterval(config.interval);

  return function subscribe(this: any, _onEvent: (event: MutationEvent) => void): () => void {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const refetch = this.refetch as () => Promise<unknown>;

    const tick = async () => {
      if (!active) return;
      try {
        await refetch();
      } catch {
        // Keep polling after errors
      }
      if (active) {
        timer = setTimeout(tick, interval);
      }
    };

    timer = setTimeout(tick, interval);

    return () => {
      active = false;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    };
  };
}
