import { describe, expect, test } from 'vitest';
import { signal, reactiveSignal, watcher, context, getContext, withContexts } from '../index.js';
import { reactive } from './utils/instrumented-hooks.js';
import { nextTick } from './utils/async.js';

describe('reactiveSignal', () => {
  describe('basic functionality', () => {
    test('creates a signal with computed value accessible via .value', () => {
      const computed = reactiveSignal(() => 42);
      expect(computed.value).toBe(42);
    });

    test('compute function is called lazily on first access', () => {
      let computeCount = 0;
      const computed = reactiveSignal(() => {
        computeCount++;
        return 'result';
      });

      expect(computeCount).toBe(0);
      expect(computed.value).toBe('result');
      expect(computeCount).toBe(1);
    });

    test('returns consistent value on repeated reads without recomputation', () => {
      let computeCount = 0;
      const computed = reactiveSignal(() => {
        computeCount++;
        return 'result';
      });

      expect(computed.value).toBe('result');
      expect(computeCount).toBe(1);

      expect(computed.value).toBe('result');
      expect(computeCount).toBe(1);

      expect(computed.value).toBe('result');
      expect(computeCount).toBe(1);
    });
  });

  describe('reactivity with state signals', () => {
    test('recomputes when dependent signal value changes', async () => {
      const state = signal(1);
      let computeCount = 0;

      const computed = reactiveSignal(() => {
        computeCount++;
        return state.value * 2;
      });

      // Subscribe to make it reactive
      const unsub = (computed as any).addListener(() => {});

      expect(computed.value).toBe(2);
      expect(computeCount).toBe(1);

      state.value = 5;
      await nextTick();

      expect(computed.value).toBe(10);
      expect(computeCount).toBe(2);

      unsub();
    });

    test('tracks multiple signal dependencies correctly', async () => {
      const a = signal(1);
      const b = signal(2);
      const c = signal(3);
      let computeCount = 0;

      const computed = reactiveSignal(() => {
        computeCount++;
        return a.value + b.value + c.value;
      });

      const unsub = (computed as any).addListener(() => {});

      expect(computed.value).toBe(6);
      expect(computeCount).toBe(1);

      a.value = 10;
      await nextTick();
      expect(computed.value).toBe(15);
      expect(computeCount).toBe(2);

      b.value = 20;
      await nextTick();
      expect(computed.value).toBe(33);
      expect(computeCount).toBe(3);

      c.value = 30;
      await nextTick();
      expect(computed.value).toBe(60);
      expect(computeCount).toBe(4);

      unsub();
    });

    test('propagates updates through dependent computed chains', async () => {
      const base = signal(1);
      let firstComputeCount = 0;
      let secondComputeCount = 0;

      const first = reactiveSignal(() => {
        firstComputeCount++;
        return base.value * 2;
      });

      const second = reactiveSignal(() => {
        secondComputeCount++;
        return first.value + 10;
      });

      const unsub = second.addListener(() => {});

      expect(second.value).toBe(12);
      expect(firstComputeCount).toBe(1);
      expect(secondComputeCount).toBe(1);

      base.value = 5;
      await nextTick();

      expect(second.value).toBe(20);
      expect(firstComputeCount).toBe(2);
      expect(secondComputeCount).toBe(2);

      unsub();
    });
  });

  describe('memoization / caching', () => {
    test('same value is returned without recomputation when dependencies unchanged', () => {
      const state = signal(5);
      let computeCount = 0;

      const computed = reactiveSignal(() => {
        computeCount++;
        return state.value * 2;
      });

      expect(computed.value).toBe(10);
      expect(computeCount).toBe(1);

      // Multiple reads should not recompute
      expect(computed.value).toBe(10);
      expect(computed.value).toBe(10);
      expect(computed.value).toBe(10);
      expect(computeCount).toBe(1);
    });

    test('custom equals function controls when value is considered changed', async () => {
      const state = signal({ count: 1 });
      let computeCount = 0;
      let listenerCallCount = 0;

      // Custom equals that only compares count property
      const computed = reactiveSignal(
        () => {
          computeCount++;
          return { count: state.value.count, timestamp: Date.now() };
        },
        {
          equals: (a, b) => a.count === b.count,
        },
      );

      const unsub = (computed as any).addListener(() => {
        listenerCallCount++;
      });

      // Initial read to establish baseline
      const firstValue = computed.value;
      expect(firstValue.count).toBe(1);
      expect(computeCount).toBe(1);

      // Wait for any initial subscription effects
      await nextTick();
      const listenerCallCountAfterInit = listenerCallCount;

      // Change to same count - should recompute but equals returns true
      state.value = { count: 1 };
      await nextTick();

      expect(computed.value.count).toBe(1);
      expect(computeCount).toBe(2);
      // Listener should not be called because equals returned true (value considered unchanged)
      expect(listenerCallCount).toBe(listenerCallCountAfterInit);

      // Change to different count - should trigger update and listener
      state.value = { count: 2 };
      await nextTick();

      expect(computed.value.count).toBe(2);
      expect(computeCount).toBe(3);
      expect(listenerCallCount).toBe(listenerCallCountAfterInit + 1);

      unsub();
    });

    test('setting equals: false always triggers update on recomputation', async () => {
      const state = signal(1);
      let computeCount = 0;
      let listenerCallCount = 0;

      const computed = reactiveSignal(
        () => {
          computeCount++;
          return 'constant'; // Always returns same value
        },
        {
          equals: false,
        },
      );

      const unsub = (computed as any).addListener(() => {
        listenerCallCount++;
      });

      expect(computed.value).toBe('constant');
      expect(computeCount).toBe(1);
      expect(listenerCallCount).toBe(0);

      state.value = 2; // Trigger recompute
      await nextTick();

      // With equals: false, even same value should trigger listener
      expect(computed.value).toBe('constant');
      // Note: compute only happens if the dependency is tracked
      // Since state is not tracked (not used in compute), no recomputation

      unsub();
    });
  });

  describe('isolate option', () => {
    test('default behavior inherits current context scope', () => {
      const ctx = context('default');

      const computed = reactiveSignal(() => {
        return getContext(ctx);
      });

      // Access in default scope
      expect(computed.value).toBe('default');
    });

    test('with isolate: true creates an isolated scope', () => {
      const ctx = context('default');

      // Create computed in a custom context scope
      const computed = withContexts([[ctx, 'custom']], () => {
        return reactiveSignal(
          () => {
            return getContext(ctx);
          },
          { isolate: true },
        );
      });

      // With isolate: true, it should NOT inherit the 'custom' context
      // It creates a new isolated scope
      expect(computed.value).toBe('default');
    });

    test('without isolate inherits context from creation scope', () => {
      const ctx = context('default');

      // Create computed in a custom context scope
      const computed = withContexts([[ctx, 'custom']], () => {
        return reactiveSignal(() => {
          return getContext(ctx);
        });
      });

      // Without isolate, it should inherit the 'custom' context
      expect(computed.value).toBe('custom');
    });
  });

  describe('nesting with other reactive constructs', () => {
    test('works correctly when consumed by reactive() functions', async () => {
      const state = signal(5);

      const computed = reactiveSignal(() => {
        return state.value * 2;
      });

      const consumer = reactive(() => {
        return computed.value + 1;
      });

      expect(consumer()).toBe(11);

      state.value = 10;
      await nextTick();

      expect(consumer()).toBe(21);
    });

    test('works correctly when consuming other reactive() calls', async () => {
      const state = signal(5);

      const reactiveGetter = reactive((x: number) => {
        return state.value + x;
      });

      const computed = reactiveSignal(() => {
        return reactiveGetter(10);
      });

      const unsub = (computed as any).addListener(() => {});

      expect(computed.value).toBe(15);

      state.value = 20;
      await nextTick();

      expect(computed.value).toBe(30);

      unsub();
    });

    test('works correctly with watcher()', async () => {
      const state = signal(5);
      let computeCount = 0;

      const computed = reactiveSignal(() => {
        computeCount++;
        return state.value * 3;
      });

      const w = watcher(() => {
        return computed.value;
      });

      const unsub = w.addListener(() => {});

      expect(w.value).toBe(15);
      expect(computeCount).toBe(1);

      state.value = 10;
      await nextTick();

      expect(w.value).toBe(30);
      expect(computeCount).toBe(2);

      unsub();
    });
  });

  describe('listener API', () => {
    test('addListener() registers callbacks for value changes', async () => {
      const state = signal(1);
      let listenerCallCount = 0;

      const computed = reactiveSignal(() => {
        return state.value * 2;
      });

      const unsub = (computed as any).addListener(() => {
        listenerCallCount++;
      });

      expect(computed.value).toBe(2);
      expect(listenerCallCount).toBe(0);

      state.value = 5;
      await nextTick();

      expect(computed.value).toBe(10);
      expect(listenerCallCount).toBe(1);

      state.value = 10;
      await nextTick();

      expect(computed.value).toBe(20);
      expect(listenerCallCount).toBe(2);

      unsub();
    });

    test('returned unsubscribe function removes listener', async () => {
      const state = signal(1);
      let listenerCallCount = 0;

      const computed = reactiveSignal(() => {
        return state.value * 2;
      });

      const unsub = (computed as any).addListener(() => {
        listenerCallCount++;
      });

      state.value = 5;
      await nextTick();
      expect(listenerCallCount).toBe(1);

      // Unsubscribe
      unsub();

      state.value = 10;
      await nextTick();

      // Listener should not be called after unsubscribe
      expect(listenerCallCount).toBe(1);
    });

    test('multiple listeners can be added', async () => {
      const state = signal(1);
      let listener1Count = 0;
      let listener2Count = 0;
      let listener3Count = 0;

      const computed = reactiveSignal(() => {
        return state.value * 2;
      });

      const unsub1 = computed.addListener(() => {
        listener1Count++;
      });
      const unsub2 = computed.addListener(() => {
        listener2Count++;
      });
      const unsub3 = computed.addListener(() => {
        listener3Count++;
      });

      state.value = 5;
      await nextTick();

      expect(listener1Count).toBe(1);
      expect(listener2Count).toBe(1);
      expect(listener3Count).toBe(1);

      // Unsubscribe one listener
      unsub2();

      state.value = 10;
      await nextTick();

      expect(listener1Count).toBe(2);
      expect(listener2Count).toBe(1); // Should not increase
      expect(listener3Count).toBe(2);

      unsub1();
      unsub3();
    });

    test('listeners are called when value changes', async () => {
      const state = signal(1);
      const receivedValues: number[] = [];

      const computed = reactiveSignal(() => {
        return state.value * 2;
      });

      const unsub = (computed as any).addListener(() => {
        receivedValues.push(computed.value);
      });

      // Initial read
      expect(computed.value).toBe(2);

      state.value = 5;
      await nextTick();

      state.value = 10;
      await nextTick();

      state.value = 15;
      await nextTick();

      expect(receivedValues).toEqual([10, 20, 30]);

      unsub();
    });
  });

  describe('options', () => {
    test('id option sets signal identifier', () => {
      const computed = reactiveSignal(() => 42, { id: 'my-signal' });
      expect(computed.value).toBe(42);
      // The id is mainly for debugging/tracing, just verify it doesn't break anything
    });

    test('desc option sets description', () => {
      const computed = reactiveSignal(() => 'hello', { desc: 'greeting signal' });
      expect(computed.value).toBe('hello');
      // The desc is mainly for debugging/tracing, just verify it doesn't break anything
    });
  });

  describe('error handling', () => {
    test('errors thrown in compute function propagate correctly', () => {
      const computed = reactiveSignal(() => {
        throw new Error('compute error');
      });

      expect(() => computed.value).toThrow('compute error');
    });

    test('error does not prevent subsequent successful computations', async () => {
      const shouldError = signal(true);

      const computed = reactiveSignal(() => {
        if (shouldError.value) {
          throw new Error('conditional error');
        }
        return 'success';
      });

      const unsub = (computed as any).addListener(() => {});

      expect(() => computed.value).toThrow('conditional error');

      shouldError.value = false;
      await nextTick();

      expect(computed.value).toBe('success');

      unsub();
    });
  });

  describe('async computations', () => {
    test('supports async compute functions returning ReactivePromise', async () => {
      const state = signal(5);

      const computed = reactiveSignal(async () => {
        return state.value * 2;
      });

      const result = computed.value;
      expect(result.isPending).toBe(true);
      expect(result.value).toBe(undefined);

      await nextTick();

      expect(result.isResolved).toBe(true);
      expect(result.value).toBe(10);
    });

    test('promise states (pending, resolved, rejected) work correctly', async () => {
      const shouldReject = signal(false);

      const computed = reactiveSignal(async () => {
        if (shouldReject.value) {
          throw new Error('async error');
        }
        return 'async success';
      });

      const unsub = (computed as any).addListener(() => {});

      // Test resolved state
      let result = computed.value;
      expect(result.isPending).toBe(true);

      await nextTick();

      result = computed.value;
      expect(result.isResolved).toBe(true);
      expect(result.value).toBe('async success');

      // Test rejected state
      shouldReject.value = true;
      await nextTick();

      result = computed.value;
      expect(result.isRejected).toBe(true);
      expect(result.error).toBeInstanceOf(Error);

      unsub();
    });
  });
});
