import { describe, expect, test, vi } from 'vitest';
import { watchOnce, relay, signal, reactive } from '../index.js';
import { nextTick } from './utils/async.js';

describe('watchOnce', () => {
  test('runs a synchronous function once', async () => {
    const computeFn = vi.fn(() => 42);

    const result = await watchOnce(computeFn);

    expect(result).toBe(42);
    expect(computeFn).toHaveBeenCalledTimes(1);
  });

  test('runs an async function once', async () => {
    const computeFn = vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      return 'async result';
    });

    const result = await watchOnce(computeFn);

    expect(result).toBe('async result');
    expect(computeFn).toHaveBeenCalledTimes(1);
  });

  test('activates relays during execution', async () => {
    const activateFn = vi.fn(state => {
      state.value = 'relay value';
      return () => {
        // cleanup
      };
    });

    const result = await watchOnce(() => {
      const r = relay(activateFn);
      return r.value;
    });

    expect(result).toBe('relay value');
    expect(activateFn).toHaveBeenCalledTimes(1);
  });

  test('tears down relays after completion', async () => {
    const cleanupFn = vi.fn();
    const activateFn = vi.fn(state => {
      state.value = 'value';
      return cleanupFn;
    });

    await watchOnce(() => {
      const r = relay(activateFn);
      return r.value;
    });

    // Note: cleanup is scheduled asynchronously
    await nextTick();

    expect(activateFn).toHaveBeenCalledTimes(1);
    expect(cleanupFn).toHaveBeenCalledTimes(1);
  });

  test('does not reschedule on signal changes', async () => {
    const s = signal(1);
    const computeFn = vi.fn(() => s.value);

    const result = await watchOnce(computeFn);

    expect(result).toBe(1);
    expect(computeFn).toHaveBeenCalledTimes(1);

    // Change the signal
    s.value = 2;
    await nextTick();

    // Should not have run again
    expect(computeFn).toHaveBeenCalledTimes(1);
  });

  test('handles errors in sync functions', async () => {
    const error = new Error('sync error');

    await expect(() => {
      watchOnce(() => {
        throw error;
      });
    }).toThrow('sync error');
  });

  test('handles errors in async functions', async () => {
    const error = new Error('async error');

    await expect(
      watchOnce(async () => {
        throw error;
      }),
    ).rejects.toThrow('async error');
  });

  test('can return relay values directly', async () => {
    const result = await watchOnce(() => {
      const r = relay(state => {
        state.value = 'relay value';
      });

      return r.value;
    });

    expect(result).toBe('relay value');
  });

  test('can access reactive functions inside watchOnce', async () => {
    const s = signal(10);
    const double = reactive(() => s.value * 2);

    const result = await watchOnce(() => double());

    expect(result).toBe(20);
  });

  test('can access reactive functions with relays inside watchOnce', async () => {
    const activateFn = vi.fn(state => {
      state.value = 5;
    });

    const result = await watchOnce(() => {
      const r = relay<number>(activateFn);
      const doubled = reactive(() => r.value! * 2);
      return doubled();
    });

    expect(result).toBe(10);
    expect(activateFn).toHaveBeenCalledTimes(1);
  });

  test('unwatches even if function throws', async () => {
    const cleanupFn = vi.fn();
    const activateFn = vi.fn(state => {
      state.value = 'value';
      return cleanupFn;
    });

    await expect(() => {
      watchOnce(() => {
        const r = relay(activateFn);
        const val = r.value;
        throw new Error('test error');
      });
    }).toThrow('test error');

    // Wait for cleanup to occur
    await nextTick();

    // Should still have cleaned up
    expect(cleanupFn).toHaveBeenCalledTimes(1);
  });

  test('handles sequential relay operations', async () => {
    const s = signal('first');

    const result = await watchOnce(() => {
      const r1 = relay(state => {
        state.value = s.value;

        return {
          update: () => {
            state.value = s.value;
          },
        };
      });

      // Read the relay value
      const value1 = r1.value;

      // Create another relay that depends on the first
      const r2 = relay(state => {
        state.value = value1 + ' second';
      });

      return r2.value;
    });

    expect(result).toBe('first second');
  });

  test('multiple sequential watchOnce calls work independently', async () => {
    const s = signal(1);

    const result1 = await watchOnce(() => s.value);
    expect(result1).toBe(1);

    s.value = 2;

    const result2 = await watchOnce(() => s.value);
    expect(result2).toBe(2);
  });

  test('concurrent watchOnce calls work independently', async () => {
    const s = signal(1);

    const promise1 = watchOnce(async () => {
      await new Promise(resolve => setTimeout(resolve, 20));
      return s.value;
    });

    const promise2 = watchOnce(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      s.value = 2;
      return s.value;
    });

    const [result1, result2] = await Promise.all([promise1, promise2]);

    // result1 should see the updated value since promise2 completes first
    expect(result2).toBe(2);
  });
});
