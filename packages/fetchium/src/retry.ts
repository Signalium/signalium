import type { ResolvedRetryConfig } from './query.js';

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: ResolvedRetryConfig,
  signal?: AbortSignal,
): Promise<T> {
  if (IS_DEV && config.retries < 0) {
    throw new Error('retries must be non-negative');
  }
  const retries = Math.max(0, config.retries);
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    signal?.throwIfAborted();
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= retries) throw error;
      await sleep(config.retryDelay(attempt), signal);
    }
  }
  throw lastError;
}
