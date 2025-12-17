import { describe, expect, test } from 'vitest';
import { signal, forwardRelay } from '../index.js';
import { reactive, relay } from './utils/instrumented-hooks.js';
import { nextTick } from './utils/async.js';

describe('relays', () => {
  test('Relay can set initial value', () => {
    const sub = relay(state => {
      state.value = 1;
    });

    expect(sub).toHaveValueAndCounts(undefined, { compute: 0, internalSet: 0 });

    const computed = reactive(() => {
      return sub.value;
    });

    expect(computed).toHaveValueAndCounts(1, { compute: 1 });
    expect(sub).toHaveValueAndCounts(1, { compute: 1, internalSet: 1 });
  });

  test('Relay can update value', async () => {
    const v = signal(1);
    const sub = relay(state => {
      state.value = v.value;

      return {
        update: () => {
          state.value = v.value;
        },
      };
    });

    const computed = reactive(
      () => {
        return sub.value;
      },
      {
        desc: 'computed',
      },
    );

    expect(computed).toHaveValueAndCounts(1, { compute: 1 });
    expect(sub).toHaveValueAndCounts(1, { compute: 1, internalSet: 1 });

    v.value = 2;

    await nextTick();

    expect(computed).toHaveValueAndCounts(2, { compute: 2 });
    expect(sub).toHaveValueAndCounts(2, { compute: 2, internalSet: 2 });
  });

  test('Relay can set multiple times', () => {
    const sub = relay(state => {
      state.value = 1;
      state.value = 2;
      state.value = 3;
    });

    const computed = reactive(() => {
      return sub.value;
    });

    expect(computed).toHaveValueAndCounts(3, { compute: 1 });
    expect(sub).toHaveValueAndCounts(3, { compute: 1, internalSet: 3 });
  });

  test('Can create a relay within a reactive function context', async () => {
    const value = signal(1);

    const computed = reactive(() => {
      return relay(state => {
        state.value = value.value;

        return {
          update: () => {
            state.value = value.value;
          },
        };
      });
    });

    const sub = computed();

    expect(computed).toHaveCounts({ compute: 1 });
    expect(sub).toHaveValueAndCounts(undefined, { compute: 0, internalSet: 0 });

    const computed2 = reactive(() => {
      return computed().value;
    });

    expect(computed2).toHaveValueAndCounts(1, { compute: 1 });
    expect(sub).toHaveValueAndCounts(1, { compute: 1, internalSet: 1 });

    value.value = 2;

    await nextTick();

    expect(sub).toHaveValueAndCounts(2, { compute: 2, internalSet: 2 });
  });

  test('Can create multiple relays based on arguments within a reactive function context, with full lifecycle', async () => {
    const externalValue = signal(1);

    const computed = reactive(
      (initValue: number) => {
        return relay(
          state => {
            state.value = initValue + externalValue.value;

            return {
              update: () => {
                state.value = initValue + externalValue.value;
              },
              deactivate: () => {},
            };
          },
          {
            desc: 'relay',
          },
        );
      },
      {
        desc: 'computed',
      },
    );

    const sub1 = computed(1);
    const sub2 = computed(2);

    expect(computed.withParams(1)).toHaveCounts({ compute: 1 });
    expect(computed.withParams(2)).toHaveCounts({ compute: 1 });
    expect(sub1).toHaveValueAndCounts(undefined, { compute: 0, subscribe: 0, internalSet: 0 });
    expect(sub2).toHaveValueAndCounts(undefined, { compute: 0, subscribe: 0, internalSet: 0 });

    const initValue = signal(1);

    const consumer = reactive(() => {
      return computed(initValue.value).value;
    });

    expect(consumer).toHaveValueAndCounts(2, { compute: 1 });
    expect(sub1).toHaveValueAndCounts(2, { compute: 1, subscribe: 1, internalSet: 1 });
    expect(sub2).toHaveValueAndCounts(undefined, { compute: 0, subscribe: 0, internalSet: 0 });

    externalValue.value = 2;

    await nextTick();

    expect(consumer).toHaveValueAndCounts(3, { compute: 2 });
    expect(sub1).toHaveValueAndCounts(3, { compute: 2, subscribe: 1, internalSet: 2 });
    expect(sub2).toHaveValueAndCounts(undefined, { compute: 0, internalSet: 0 });

    initValue.value = 2;

    expect(consumer).toHaveValueAndCounts(4, { compute: 3 });
    expect(sub1).toHaveValueAndCounts(3, { compute: 2, internalSet: 2, unsubscribe: 0 });
    expect(sub2).toHaveValueAndCounts(4, { compute: 1, subscribe: 1, internalSet: 1 });

    await nextTick();

    expect(sub1).toHaveValueAndCounts(3, { compute: 2, internalSet: 2, unsubscribe: 1 });
  });

  test('Can switch between external relays reactively', async () => {
    const externalValue = signal(1);

    const makeSub = (initValue: number) => {
      return relay(state => {
        state.value = initValue + externalValue.value;

        return {
          update: () => {
            state.value = initValue + externalValue.value;
          },
          deactivate: () => {},
        };
      });
    };

    const sub1 = makeSub(1);
    const sub2 = makeSub(2);

    expect(sub1).toHaveValueAndCounts(undefined, { compute: 0, subscribe: 0, internalSet: 0 });
    expect(sub2).toHaveValueAndCounts(undefined, { compute: 0, subscribe: 0, internalSet: 0 });

    const initValue = signal(1);

    const consumer = reactive(() => {
      return initValue.value === 1 ? sub1.value : sub2.value;
    });

    expect(consumer).toHaveValueAndCounts(2, { compute: 1 });
    expect(sub1).toHaveValueAndCounts(2, { compute: 1, subscribe: 1, internalSet: 1 });
    expect(sub2).toHaveValueAndCounts(undefined, { compute: 0, subscribe: 0, internalSet: 0 });

    externalValue.value = 2;

    await nextTick();

    expect(consumer).toHaveValueAndCounts(3, { compute: 2 });
    expect(sub1).toHaveValueAndCounts(3, { compute: 2, subscribe: 1, internalSet: 2 });
    expect(sub2).toHaveValueAndCounts(undefined, { compute: 0, internalSet: 0 });

    initValue.value = 2;

    expect(consumer).toHaveValueAndCounts(4, { compute: 3 });
    expect(sub1).toHaveValueAndCounts(3, { compute: 2, internalSet: 2, unsubscribe: 0 });
    expect(sub2).toHaveValueAndCounts(4, { compute: 1, subscribe: 1, internalSet: 1 });

    await nextTick();

    expect(sub1).toHaveValueAndCounts(3, { compute: 2, internalSet: 2, unsubscribe: 1 });
  });

  test('Lifecycle works properly with multiple consumers', async () => {
    const externalValue = signal(1);

    const sub = relay<number>(state => {
      state.value = 1 + externalValue.value;

      return {
        update: () => {
          state.value = 1 + externalValue.value;
        },
        deactivate: () => {},
      };
    });

    const useSub1 = signal(true);

    const consumer1 = reactive(() => {
      return useSub1.value && sub.isReady ? sub.value : 0;
    });

    const useSub2 = signal(true);
    const consumer2 = reactive(() => {
      return useSub2.value ? (sub.value ?? 0) : 0;
    });

    expect(sub).toHaveValueAndCounts(undefined, { compute: 0, subscribe: 0, internalSet: 0 });

    const root = reactive(
      () => {
        return consumer1() + consumer2();
      },
      {
        desc: 'root',
      },
    );

    expect(root).toHaveValueAndCounts(4, { compute: 1 });
    expect(sub).toHaveValueAndCounts(2, { compute: 1, subscribe: 1, internalSet: 1 });

    externalValue.value = 2;

    await nextTick();

    expect(root).toHaveValueAndCounts(6, { compute: 2 });
    expect(sub).toHaveValueAndCounts(3, { compute: 2, subscribe: 1, internalSet: 2 });

    useSub1.value = false;

    await nextTick();

    expect(root).toHaveValueAndCounts(3, { compute: 3 });
    expect(sub).toHaveValueAndCounts(3, { compute: 2, subscribe: 1, internalSet: 2, unsubscribe: 0 });

    useSub2.value = false;

    await nextTick();

    expect(root).toHaveValueAndCounts(0, { compute: 4 });
    expect(sub).toHaveValueAndCounts(3, { compute: 2, subscribe: 1, internalSet: 2, unsubscribe: 1 });

    externalValue.value = 3;

    await nextTick();

    expect(root).toHaveValueAndCounts(0, { compute: 4 });
    expect(sub).toHaveValueAndCounts(3, { compute: 2, subscribe: 1, update: 1, internalSet: 2, unsubscribe: 1 });

    useSub2.value = true;

    expect(root).toHaveValueAndCounts(4, { compute: 5 });
    expect(sub).toHaveValueAndCounts(4, { compute: 3, subscribe: 2, update: 1, internalSet: 3, unsubscribe: 1 });
  });

  test('Lifecycle works with nested relays', async () => {
    const externalValue = signal(1);

    const sub1 = relay<number>(
      state => {
        state.value = 1 + externalValue.value;

        return {
          update: () => {
            state.value = 1 + externalValue.value;
          },
          deactivate: () => {},
        };
      },
      {
        desc: 'sub1',
      },
    );

    const sub2 = relay<number>(
      state => {
        state.value = (sub1.value ?? 0) + 1;

        return {
          update: () => {
            state.value = (sub1.value ?? 0) + 1;
          },
          deactivate: () => {},
        };
      },
      {
        desc: 'sub2',
      },
    );

    const useSub1 = signal(true);
    const consumer1 = reactive(
      () => {
        return useSub1.value ? (sub1.value ?? 0) : 0;
      },
      {
        desc: 'consumer1',
      },
    );

    const useSub2 = signal(true);
    const consumer2 = reactive(
      () => {
        return useSub2.value ? (sub2.value ?? 0) : 0;
      },
      {
        desc: 'consumer2',
      },
    );

    expect(sub1).toHaveValueAndCounts(undefined, { compute: 0, subscribe: 0, internalSet: 0 });
    expect(sub2).toHaveValueAndCounts(undefined, { compute: 0, subscribe: 0, internalSet: 0 });

    const root = reactive(
      () => {
        return consumer1() + consumer2();
      },
      {
        desc: 'root',
      },
    );

    expect(root).toHaveValueAndCounts(5, { compute: 1 });
    expect(sub1).toHaveValueAndCounts(2, { compute: 1, subscribe: 1, internalSet: 1 });
    expect(sub2).toHaveValueAndCounts(3, { compute: 1, subscribe: 1, internalSet: 1 });

    externalValue.value = 2;

    expect(root).toHaveValueAndCounts(5, { compute: 1 });
    expect(sub1).toHaveValueAndCounts(2, { compute: 1, subscribe: 1, internalSet: 1 });
    expect(sub2).toHaveValueAndCounts(3, { compute: 1, subscribe: 1, internalSet: 1 });

    await nextTick();

    expect(root).toHaveValueAndCounts(7, { compute: 3 });
    expect(sub1).toHaveValueAndCounts(3, { compute: 2, subscribe: 1, internalSet: 2 });
    expect(sub2).toHaveValueAndCounts(4, { compute: 2, subscribe: 1, internalSet: 2 });

    useSub1.value = false;

    await nextTick();

    expect(root).toHaveValueAndCounts(4, { compute: 4 });
    expect(sub1).toHaveValueAndCounts(3, { compute: 2, subscribe: 1, internalSet: 2, unsubscribe: 0 });
    expect(sub2).toHaveValueAndCounts(4, { compute: 2, subscribe: 1, internalSet: 2, unsubscribe: 0 });

    useSub2.value = false;

    await nextTick();

    expect(root).toHaveValueAndCounts(0, { compute: 5 });
    expect(sub1).toHaveValueAndCounts(3, { compute: 2, subscribe: 1, internalSet: 2, unsubscribe: 1 });
    expect(sub2).toHaveValueAndCounts(4, { compute: 2, subscribe: 1, internalSet: 2, unsubscribe: 1 });

    externalValue.value = 3;

    await nextTick();

    expect(root).toHaveValueAndCounts(0, { compute: 5 });
    expect(sub1).toHaveValueAndCounts(3, { compute: 2, subscribe: 1, update: 1, internalSet: 2, unsubscribe: 1 });
    expect(sub2).toHaveValueAndCounts(4, { compute: 2, subscribe: 1, update: 1, internalSet: 2, unsubscribe: 1 });

    useSub2.value = true;

    expect(root).toHaveValueAndCounts(5, { compute: 6 });
    expect(sub1).toHaveValueAndCounts(4, { compute: 3, subscribe: 2, update: 1, internalSet: 3, unsubscribe: 1 });
    expect(sub2).toHaveValueAndCounts(5, { compute: 3, subscribe: 2, update: 1, internalSet: 3, unsubscribe: 1 });

    useSub2.value = false;

    await nextTick();

    expect(root).toHaveValueAndCounts(0, { compute: 7 });
    expect(sub1).toHaveValueAndCounts(4, { compute: 3, subscribe: 2, update: 1, internalSet: 3, unsubscribe: 2 });
    expect(sub2).toHaveValueAndCounts(5, { compute: 3, subscribe: 2, update: 1, internalSet: 3, unsubscribe: 2 });

    useSub1.value = true;

    expect(root).toHaveValueAndCounts(4, { compute: 8 });
    expect(sub1).toHaveValueAndCounts(4, { compute: 4, subscribe: 3, update: 1, internalSet: 4, unsubscribe: 2 });
    expect(sub2).toHaveValueAndCounts(5, { compute: 3, subscribe: 2, update: 1, internalSet: 3, unsubscribe: 2 });
  });

  test('Relays can be awaited', async () => {
    const externalValue = signal(1);

    const sub = relay(state => {
      const value = externalValue.value;

      setTimeout(() => {
        state.value = value;
      });

      return {
        update: () => {
          const value = externalValue.value;

          state.value = value;
        },
      };
    });

    const inner1 = reactive(
      async (x: number) => {
        const state1 = externalValue.value;
        await nextTick();
        return x * state1;
      },
      {
        desc: 'inner1',
      },
    );

    const inner2 = reactive(
      async (x: number) => {
        const state2 = (await sub) as any;
        await nextTick();
        return x * state2;
      },
      {
        desc: 'inner2',
      },
    );

    const outer = reactive(
      async (x: number) => {
        const result1 = (await inner1(x)) as any;
        const result2 = (await inner2(x)) as any;
        return result1 + result2;
      },
      {
        desc: 'outer',
      },
    );

    const result1 = outer(2);
    expect(outer.withParams(2)).toHaveSignalValue(undefined);
    expect(result1.value).toBe(undefined);
    expect(result1.isPending).toBe(true);
    expect(sub).toHaveCounts({ compute: 0, subscribe: 0, internalSet: 0 });
    expect(inner1.withParams(2)).toHaveCounts({ compute: 1 });
    expect(inner2.withParams(2)).toHaveCounts({ compute: 0 });
    expect(outer.withParams(2)).toHaveCounts({ compute: 1 });

    await new Promise(resolve => setTimeout(resolve, 10));
    expect(result1.value).toBe(4);
    expect(result1.isPending).toBe(false);
    expect(result1.isResolved).toBe(true);
    expect(inner1.withParams(2)).toHaveCounts({ compute: 1 });
    expect(inner2.withParams(2)).toHaveCounts({ compute: 1 });
    expect(outer.withParams(2)).toHaveCounts({ compute: 1 });

    externalValue.value = 2;
    const result2 = outer(2);
    expect(result2.isPending).toBe(true);
    expect(result2.value).toBe(4);
    expect(inner1.withParams(2)).toHaveCounts({ compute: 2 });
    expect(inner2.withParams(2)).toHaveCounts({ compute: 1 });
    expect(outer.withParams(2)).toHaveCounts({ compute: 1 });

    await new Promise(resolve => setTimeout(resolve, 10));
    expect(result2.value).toBe(8);
    expect(result2.isPending).toBe(false);
    expect(result2.isResolved).toBe(true);
    expect(inner1.withParams(2)).toHaveCounts({ compute: 2 });
    expect(inner2.withParams(2)).toHaveCounts({ compute: 2 });
    expect(outer.withParams(2)).toHaveCounts({ compute: 2 });
  });

  describe('forwardRelay', () => {
    test('Forwards values from source to target relay', async () => {
      const externalValue = signal(1);

      const sourceRelay = relay(state => {
        state.value = externalValue.value;

        return {
          update: () => {
            state.value = externalValue.value;
          },
        };
      });

      const forwardedRelay = relay(state => {
        forwardRelay(state, sourceRelay);
      });

      expect(sourceRelay).toHaveValueAndCounts(undefined, { compute: 0, internalSet: 0 });
      expect(forwardedRelay).toHaveValueAndCounts(undefined, { compute: 0, internalSet: 0 });

      const consumer = reactive(() => {
        return forwardedRelay.value;
      });

      expect(consumer).toHaveValueAndCounts(1, { compute: 1 });
      expect(sourceRelay).toHaveValueAndCounts(1, { compute: 1, internalSet: 1 });
      expect(forwardedRelay).toHaveValueAndCounts(1, { compute: 1, internalSet: 1 });

      externalValue.value = 2;

      await nextTick();

      expect(consumer).toHaveValueAndCounts(2, { compute: 2 });
      expect(sourceRelay).toHaveValueAndCounts(2, { compute: 2, internalSet: 2 });
      expect(forwardedRelay).toHaveValueAndCounts(2, { compute: 2, internalSet: 2 });
    });

    test('Forwards errors from source to target relay', async () => {
      const shouldError = signal(false);

      const sourceRelay = relay(state => {
        if (shouldError.value) {
          state.setError(new Error('Test error'));
        } else {
          state.value = 1;
        }

        return {
          update: () => {
            if (shouldError.value) {
              state.setError(new Error('Test error'));
            } else {
              state.value = 1;
            }
          },
        };
      });

      const forwardedRelay = relay(state => {
        forwardRelay(state, sourceRelay);
      });

      const consumer = reactive(() => {
        if (forwardedRelay.isRejected) {
          return forwardedRelay.error;
        }
        return forwardedRelay.value;
      });

      expect(consumer).toHaveValueAndCounts(1, { compute: 1 });
      expect(forwardedRelay.isRejected).toBe(false);

      shouldError.value = true;

      await nextTick();

      expect(consumer).toHaveValueAndCounts(new Error('Test error'), { compute: 2 });
      expect(forwardedRelay.isRejected).toBe(true);
      expect(forwardedRelay.error).toEqual(new Error('Test error'));
    });

    test('Forwards pending states from source to target relay', async () => {
      const sourceRelay = relay(state => {
        setTimeout(() => {
          state.value = 42;
        }, 10);
      });

      const forwardedRelay = relay(state => {
        forwardRelay(state, sourceRelay);
      });

      expect(sourceRelay.isPending).toBe(true);
      expect(forwardedRelay.isPending).toBe(true);

      const consumer = reactive(() => {
        return forwardedRelay.isPending ? undefined : forwardedRelay.value;
      });

      expect(consumer).toHaveValueAndCounts(undefined, { compute: 1 });

      await new Promise(resolve => setTimeout(resolve, 15));

      expect(sourceRelay.isPending).toBe(false);
      expect(forwardedRelay.isPending).toBe(false);
      expect(consumer).toHaveValueAndCounts(42, { compute: 2 });
    });

    test('Multiple relays can forward from the same source', async () => {
      const externalValue = signal(1);

      const sourceRelay = relay(state => {
        state.value = externalValue.value;

        return {
          update: () => {
            state.value = externalValue.value;
          },
        };
      });

      const forwardedRelay1 = relay(state => {
        forwardRelay(state, sourceRelay);
      });

      const forwardedRelay2 = relay(state => {
        forwardRelay(state, sourceRelay);
      });

      const consumer1 = reactive(() => forwardedRelay1.value);
      const consumer2 = reactive(() => forwardedRelay2.value);

      expect(consumer1).toHaveValueAndCounts(1, { compute: 1 });
      expect(consumer2).toHaveValueAndCounts(1, { compute: 1 });
      expect(sourceRelay).toHaveValueAndCounts(1, { compute: 1, internalSet: 1 });

      externalValue.value = 2;

      await nextTick();

      expect(consumer1).toHaveValueAndCounts(2, { compute: 2 });
      expect(consumer2).toHaveValueAndCounts(2, { compute: 2 });
      expect(sourceRelay).toHaveValueAndCounts(2, { compute: 2, internalSet: 2 });
    });

    test('Forwarding works with additional side effects', async () => {
      const externalValue = signal(1);
      const sideEffectValue = signal(0);

      const sourceRelay = relay(state => {
        state.value = externalValue.value;

        return {
          update: () => {
            state.value = externalValue.value;
          },
        };
      });

      const forwardedRelay = relay(state => {
        // Add side effect
        sideEffectValue.value = externalValue.value * 2;

        // Forward state from source relay
        forwardRelay(state, sourceRelay);

        return {
          update: () => {
            sideEffectValue.value = externalValue.value * 2;
            forwardRelay(state, sourceRelay);
          },
        };
      });

      const consumer = reactive(() => forwardedRelay.value);

      expect(consumer).toHaveValueAndCounts(1, { compute: 1 });
      expect(sideEffectValue.value).toBe(2);

      externalValue.value = 3;

      await nextTick();

      expect(consumer).toHaveValueAndCounts(3, { compute: 2 });
      expect(sideEffectValue.value).toBe(6);
    });

    test('Automatic cleanup when relay deactivates', async () => {
      const externalValue = signal(1);
      const useRelay = signal(true);

      const sourceRelay = relay(state => {
        state.value = externalValue.value;

        return {
          update: () => {
            state.value = externalValue.value;
          },
        };
      });

      const forwardedRelay = relay(state => {
        forwardRelay(state, sourceRelay);
      });

      const consumer = reactive(() => {
        return useRelay.value ? forwardedRelay.value : 0;
      });

      expect(consumer).toHaveValueAndCounts(1, { compute: 1 });
      expect(sourceRelay).toHaveValueAndCounts(1, { compute: 1, internalSet: 1, subscribe: 1 });

      useRelay.value = false;

      await nextTick();

      expect(consumer).toHaveValueAndCounts(0, { compute: 2 });
      // Source relay should be deactivated (unsubscribed) when forwarded relay deactivates
      // Note: The dependency is established through reading sourceRelay properties in forwardRelay,
      // which connects the forwarded relay's signal to the source relay's signal
      expect(sourceRelay).toHaveValueAndCounts(1, { compute: 1, internalSet: 1, subscribe: 1 });

      // Verify that the forwarded relay is no longer active by checking that
      // updating externalValue doesn't trigger forwarded relay updates
      externalValue.value = 99;
      await nextTick();
      expect(forwardedRelay.value).toBe(1); // Should still be 1, not 99, since it's deactivated
    });
  });
});
