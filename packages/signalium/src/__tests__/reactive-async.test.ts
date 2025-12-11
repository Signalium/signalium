import { describe, expect, test } from 'vitest';
import { signal } from 'signalium';
import { reactive, relay } from './utils/instrumented-hooks.js';
import { nextTick, sleep } from './utils/async.js';

describe('async computeds', () => {
  test('Basic async computed works', async () => {
    const getC = reactive(async (a: number, b: number) => {
      return a + b;
    });

    const result1 = getC(1, 2);
    expect(result1.isPending).toBe(true);
    expect(result1.value).toBe(undefined);
    await nextTick();
    expect(result1.isResolved).toBe(true);
    expect(result1.value).toBe(3);

    const result2 = getC(2, 2);
    expect(result2.isPending).toBe(true);
    expect(result2.value).toBe(undefined);
    await nextTick();
    expect(result2.isResolved).toBe(true);
    expect(result2.value).toBe(4);
  });

  test('Async computed is not recomputed when the same arguments are passed', async () => {
    let computeCount = 0;
    const getC = reactive(async (a: number, b: number) => {
      computeCount++;
      return a + b;
    });

    const result1 = getC(1, 2);
    await nextTick();
    expect(result1.value).toBe(3);
    expect(computeCount).toBe(1);

    const result2 = getC(1, 2);
    await nextTick();
    expect(result2.value).toBe(3);
    expect(computeCount).toBe(1);
  });

  test('Async computed is recomputed when the arguments change', async () => {
    let computeCount = 0;
    const getC = reactive(async (a: number, b: number) => {
      computeCount++;
      return a + b;
    });

    const result1 = getC(1, 2);
    await nextTick();
    expect(result1.value).toBe(3);
    expect(computeCount).toBe(1);

    const result2 = getC(2, 2);
    await nextTick();
    expect(result2.value).toBe(4);
    expect(computeCount).toBe(2);
  });

  test('Async computed is recomputed when state changes', async () => {
    let computeCount = 0;
    const stateValue = signal(1);

    const getC = reactive(async (a: number) => {
      computeCount++;
      return a + stateValue.value;
    });

    const result1 = getC(1);
    await nextTick();
    expect(result1.value).toBe(2);
    expect(computeCount).toBe(1);

    stateValue.value = 2;
    const result2 = getC(1);
    expect(result2.isPending).toBe(true);
    await nextTick();
    expect(result2.value).toBe(3);
    expect(computeCount).toBe(2);
  });

  test('Async computed handles errors', async () => {
    const getC = reactive(async (shouldError: boolean) => {
      if (shouldError) {
        throw new Error('Test error');
      }
      return 'success';
    });

    const result1 = getC(false);
    await nextTick();
    expect(result1.isResolved).toBe(true);
    expect(result1.value).toBe('success');

    const result2 = getC(true);
    await nextTick();
    expect(result2.isRejected).toBe(true);
    expect(result2.error as Error).toBeInstanceOf(Error);
    expect((result2.error as Error).message).toBe('Test error');
  });

  test('Nested async computeds work correctly', async () => {
    let innerCount = 0;
    let outerCount = 0;

    const inner = reactive(async (x: number) => {
      innerCount++;
      await nextTick();
      return x * 2;
    });

    const outer = reactive(async (x: number) => {
      outerCount++;
      const innerResult = inner(x);
      const result = await innerResult;
      return result + 1;
    });

    const result1 = outer(2);
    expect(result1.value).toBe(undefined);
    expect(innerCount).toBe(1);
    expect(outerCount).toBe(1);

    await new Promise(resolve => setTimeout(resolve, 10));
    const result2 = outer(2);
    expect(result2.value).toBe(5);
    expect(innerCount).toBe(1);
    expect(outerCount).toBe(1);
  });

  test('Nested async computeds handle errors correctly', async () => {
    const inner = reactive(async (shouldError: boolean) => {
      if (shouldError) throw new Error('Inner error');
      await nextTick();
      return 'inner success';
    });

    const outer = reactive(async (shouldError: boolean) => {
      const innerResult = inner(shouldError);
      await innerResult;
      return 'outer: ' + innerResult.value;
    });

    // Test success case
    const successResult = outer(false);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(successResult.isResolved).toBe(true);
    expect(successResult.value).toBe('outer: inner success');

    // Test error case
    const errorResult = outer(true);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(errorResult.isRejected).toBe(true);
    expect(errorResult.error).toBeInstanceOf(Error);
    expect((errorResult.error as Error).message).toBe('Inner error');
  });

  test('Nested generator functions with subsequent dependencies track past the first yield', async () => {
    let inner1Count = 0;
    let inner2Count = 0;
    let outerCount = 0;

    const state1Value = signal(1);
    const state2Value = signal(2);

    const inner1 = reactive(
      async (x: number) => {
        inner1Count++;
        const state1 = state1Value.value;
        await nextTick();
        return x * state1;
      },
      {
        desc: 'inner1',
      },
    );

    const inner2 = reactive(
      async (x: number) => {
        inner2Count++;
        const state2 = state2Value.value;
        await nextTick();
        return x * state2;
      },
      {
        desc: 'inner2',
      },
    );

    const outer = reactive(
      async (x: number) => {
        outerCount++;
        const result1 = await inner1(x);
        const result2 = await inner2(x);
        return result1 + result2;
      },
      {
        desc: 'outer',
      },
    );

    const result1 = outer(2);
    expect(result1.value).toBe(undefined);
    expect(result1.isPending).toBe(true);
    expect(inner1Count).toBe(1);
    expect(inner2Count).toBe(0);
    expect(outerCount).toBe(1);

    await new Promise(resolve => setTimeout(resolve, 10));
    expect(result1.value).toBe(6);
    expect(result1.isPending).toBe(false);
    expect(result1.isResolved).toBe(true);
    expect(inner1Count).toBe(1);
    expect(inner2Count).toBe(1);
    expect(outerCount).toBe(1);

    state1Value.value = 2;
    const result2 = outer(2);
    expect(result2.isPending).toBe(true);
    expect(result2.value).toBe(6);
    expect(inner1Count).toBe(2);
    expect(inner2Count).toBe(1);
    expect(outerCount).toBe(1);

    await new Promise(resolve => setTimeout(resolve, 10));
    expect(result2.value).toBe(8);
    expect(result2.isPending).toBe(false);
    expect(result2.isResolved).toBe(true);
    expect(inner1Count).toBe(2);
    expect(inner2Count).toBe(1);
    expect(outerCount).toBe(2);

    state2Value.value = 3;
    const result3 = outer(2);
    expect(result3.isPending).toBe(true);
    expect(result3.value).toBe(8);
    expect(inner1Count).toBe(2);
    expect(inner2Count).toBe(2);
    expect(outerCount).toBe(2);

    await new Promise(resolve => setTimeout(resolve, 10));
    expect(result3.value).toBe(10);
    expect(result3.isPending).toBe(false);
    expect(result3.isResolved).toBe(true);
    expect(inner1Count).toBe(2);
    expect(inner2Count).toBe(2);
    expect(outerCount).toBe(3);
  });

  test('Nested generator functions with subsequent dependencies halt properly when a dependency is pending', async () => {
    let inner1Count = 0;
    let inner2Count = 0;
    let outerCount = 0;

    const state1Value = signal(1);
    const state2Value = signal(2);
    const state3Value = signal(3);

    const inner1 = reactive(
      function* foo(x: number) {
        inner1Count++;
        const state = state1Value.value + state2Value.value;
        yield nextTick();
        return x * state;
      },
      {
        desc: 'inner1',
      },
    );

    const inner2 = reactive(
      function* (x: number) {
        inner2Count++;
        const state = state2Value.value + state3Value.value;
        yield nextTick();
        return x * state;
      },
      {
        desc: 'inner2',
      },
    );

    const outer = reactive(
      function* (x: number) {
        outerCount++;
        const result1 = (yield inner1(x)) as any;
        const result2 = (yield inner2(x)) as any;
        return result1 + result2;
      },
      {
        desc: 'outer',
      },
    );

    const result1 = outer(2);
    expect(result1.value).toBe(undefined);
    expect(result1.isPending).toBe(true);
    expect(inner1Count).toBe(1);
    expect(inner2Count).toBe(0);
    expect(outerCount).toBe(1);

    await new Promise(resolve => setTimeout(resolve, 10));
    expect(result1.value).toBe(16);
    expect(result1.isPending).toBe(false);
    expect(result1.isResolved).toBe(true);
    expect(inner1Count).toBe(1);
    expect(inner2Count).toBe(1);
    expect(outerCount).toBe(1);

    state1Value.value = 2;
    state2Value.value = 1;
    const result2 = outer(2);
    expect(result2.isPending).toBe(true);
    expect(result2.value).toBe(16);
    expect(inner1Count).toBe(2);
    expect(inner2Count).toBe(1);
    expect(outerCount).toBe(1);

    await new Promise(resolve => setTimeout(resolve, 10));
    expect(result2.value).toBe(14);
    expect(result2.isPending).toBe(false);
    expect(result2.isResolved).toBe(true);
    expect(inner1Count).toBe(2);
    expect(inner2Count).toBe(2);
    expect(outerCount).toBe(2);

    state3Value.value = 2;
    const result3 = outer(2);
    expect(result3.isPending).toBe(true);
    expect(result3.value).toBe(14);
    expect(inner1Count).toBe(2);
    expect(inner2Count).toBe(3);
    expect(outerCount).toBe(2);

    await new Promise(resolve => setTimeout(resolve, 10));
    expect(result3.value).toBe(12);
    expect(result3.isPending).toBe(false);
    expect(result3.isResolved).toBe(true);
    expect(inner1Count).toBe(2);
    expect(inner2Count).toBe(3);
    expect(outerCount).toBe(3);
  });

  test('it re-dirties pending computeds when a dependency is updated and its ord is BEFORE the current halt', async () => {
    let inner1Count = 0;
    let inner2Count = 0;
    let outerCount = 0;

    const state1Value = signal(1);
    const state2Value = signal(2);
    const state3Value = signal(3);

    const inner1 = reactive(
      function* foo(x: number) {
        inner1Count++;
        const state = state1Value.value + state2Value.value;
        yield nextTick();
        return x * state;
      },
      {
        desc: 'inner1',
      },
    );

    const inner2 = reactive(
      function* (x: number) {
        inner2Count++;
        const state = state2Value.value + state3Value.value;
        yield nextTick();
        return x * state;
      },
      {
        desc: 'inner2',
      },
    );

    const outer = reactive(
      function* (x: number) {
        outerCount++;
        const result1 = (yield inner1(x)) as any;
        const result2 = (yield inner2(x)) as any;
        return result1 + result2;
      },
      {
        desc: 'outer',
      },
    );

    const result1 = outer(2);
    expect(result1.value).toBe(undefined);
    expect(result1.isPending).toBe(true);
    expect(inner1Count).toBe(1);
    expect(inner2Count).toBe(0);
    expect(outerCount).toBe(1);

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(result1.value).toBe(16);
    expect(result1.isPending).toBe(false);
    expect(result1.isResolved).toBe(true);
    expect(inner1Count).toBe(1);
    expect(inner2Count).toBe(1);
    expect(outerCount).toBe(1);

    state3Value.value = 2;
    const result2 = outer(2);
    expect(result2.isPending).toBe(true);
    expect(result2.value).toBe(16);
    expect(inner1Count).toBe(1);
    expect(inner2Count).toBe(2);
    expect(outerCount).toBe(1);

    state1Value.value = 2;
    const result3 = outer(2);
    expect(result3.isPending).toBe(true);
    expect(result3.value).toBe(16);
    expect(inner1Count).toBe(2);
    expect(inner2Count).toBe(2);
    expect(outerCount).toBe(1);

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(result3.value).toBe(16);
    expect(result3.isPending).toBe(false);
    expect(result3.isResolved).toBe(true);
    expect(inner1Count).toBe(2);
    expect(inner2Count).toBe(2);
    expect(outerCount).toBe(2);
  });

  test('it does NOT redirty pending computeds when a dependency is updated and its ord is AFTER the current halt', async () => {
    let inner1Count = 0;
    let inner2Count = 0;
    let outerCount = 0;

    const state1Value = signal(1);
    const state2Value = signal(2);
    const state3Value = signal(3);

    const inner1 = reactive(
      function* foo(x: number) {
        inner1Count++;
        const state = state1Value.value + state2Value.value;
        yield nextTick();
        return x * state;
      },
      {
        desc: 'inner1',
      },
    );

    const inner2 = reactive(
      function* (x: number) {
        inner2Count++;
        const state = state2Value.value + state3Value.value;
        yield nextTick();
        return x * state;
      },
      {
        desc: 'inner2',
      },
    );

    const outer = reactive(
      function* (x: number) {
        outerCount++;
        const result1 = (yield inner1(x)) as any;
        const result2 = (yield inner2(x)) as any;
        return result1 + result2;
      },
      {
        desc: 'outer',
      },
    );

    const result1 = outer(2);
    expect(result1.value).toBe(undefined);
    expect(result1.isPending).toBe(true);
    expect(inner1Count).toBe(1);
    expect(inner2Count).toBe(0);
    expect(outerCount).toBe(1);

    await new Promise(resolve => setTimeout(resolve, 10));
    expect(result1.value).toBe(16);
    expect(result1.isPending).toBe(false);
    expect(result1.isResolved).toBe(true);
    expect(inner1Count).toBe(1);
    expect(inner2Count).toBe(1);
    expect(outerCount).toBe(1);

    state1Value.value = 2;
    const result2 = outer(2);
    expect(result2.isPending).toBe(true);
    expect(result2.value).toBe(16);
    expect(inner1Count).toBe(2);
    expect(inner2Count).toBe(1);
    expect(outerCount).toBe(1);

    state3Value.value = 2;
    const result3 = outer(2);
    expect(result3.isPending).toBe(true);
    expect(result3.value).toBe(16);
    expect(inner1Count).toBe(2);
    expect(inner2Count).toBe(1);
    expect(outerCount).toBe(1);

    await new Promise(resolve => setTimeout(resolve, 10));
    expect(result3.value).toBe(16);
    expect(result3.isPending).toBe(false);
    expect(result3.isResolved).toBe(true);
    expect(inner1Count).toBe(2);
    expect(inner2Count).toBe(2);
    expect(outerCount).toBe(2);
  });

  test('Unchanged promise dependencies preserve their subscription edges in _awaitSubs', async () => {
    // This test verifies that when a promise goes pending and then resolves to
    // the SAME value, we still need to re-add the dependency edge back to _awaitSubs.
    // Without this, the outer signal loses its subscription to that promise,
    // causing it to not react when that promise later changes to a new value.
    //
    // The bug: In checkSignal(), when checking promise dependencies:
    // - If a promise was pending, we'd add it to _awaitSubs and halt
    // - If a promise had a new value (updatedAt !== _updatedCount), we'd mark dirty
    // - If a promise resolved to the same value (updatedAt === _updatedCount), we
    //   did nothing - missing the dep['_awaitSubs'].set(ref, edge) call
    //
    // This caused dangling references: after a promise resolved to the same value,
    // the outer signal lost its subscription and wouldn't react to future changes.

    let innerCount = 0;
    let outerCount = 0;

    const a = signal(1);
    const b = signal(2);

    // inner depends on a + b, returns the sum
    const inner = reactive(
      async () => {
        innerCount++;
        const sum = a.value + b.value;
        await nextTick();
        return sum;
      },
      { desc: 'inner' },
    );

    const outer = reactive(
      async () => {
        outerCount++;
        const v = await inner();
        return v * 10;
      },
      { desc: 'outer' },
    );

    // Initial run: a=1, b=2, sum=3
    const r1 = outer();
    expect(r1.isPending).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(r1.isResolved).toBe(true);
    expect(r1.value).toBe(30); // 3 * 10
    expect(innerCount).toBe(1);
    expect(outerCount).toBe(1);

    // Step 1: Change a and b such that inner goes pending but resolves to SAME value
    // a=2, b=1 → sum is still 3
    a.value = 2;
    b.value = 1;

    const r2 = outer();
    expect(r2.isPending).toBe(true);
    expect(innerCount).toBe(2); // inner recomputed

    await new Promise(resolve => setTimeout(resolve, 20));
    expect(r2.isResolved).toBe(true);
    expect(r2.value).toBe(30); // Still 3 * 10 = 30 (same value)
    // outer should NOT have rerun because inner resolved to the same value
    expect(outerCount).toBe(1);

    // Step 2: CRITICAL - Now change values so inner resolves to a DIFFERENT value
    // This is where the bug would manifest: if outer lost its subscription to
    // inner's _awaitSubs, it won't be notified of this change.
    // a=3, b=2 → sum is 5
    a.value = 3;
    b.value = 2;

    const r3 = outer();
    expect(r3.isPending).toBe(true);
    expect(innerCount).toBe(3); // inner recomputed again

    await new Promise(resolve => setTimeout(resolve, 20));
    expect(r3.isResolved).toBe(true);
    // Without the fix: outer still shows 30 because it lost subscription
    // With the fix: outer shows 50 (5 * 10)
    expect(r3.value).toBe(50);
    expect(outerCount).toBe(2); // outer SHOULD have rerun now
  });

  test('Outer clears pending without rerun when inner resolves to same value', async () => {
    let innerCount = 0;
    let outerCount = 0;

    const a = signal(1);
    const b = signal(2);

    const inner = reactive(
      async () => {
        innerCount++;
        const sum = a.value + b.value;
        await nextTick();
        return sum;
      },
      { desc: 'inner' },
    );

    const outer = reactive(
      async () => {
        outerCount++;
        const v = await inner();
        return v + 1;
      },
      { desc: 'outer' },
    );

    const r1 = outer();
    expect(r1.isPending).toBe(true);
    expect(r1.value).toBe(undefined);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(r1.isResolved).toBe(true);
    expect(r1.value).toBe(4); // (1 + 2) + 1
    expect(innerCount).toBe(1);
    expect(outerCount).toBe(1);

    // Change dependencies so inner goes pending but resolves to the SAME value
    a.value = 2; // sum would be 3 after both updates
    b.value = 1;

    const r2 = outer();
    expect(r2.isPending).toBe(true);
    expect(r2.value).toBe(4); // previous cached value while pending
    // Outer should not rerun while dependency is pending
    expect(outerCount).toBe(1);

    await new Promise(resolve => setTimeout(resolve, 10));

    // Inner resolved to same value; outer clears pending but does NOT rerun
    expect(r2.isPending).toBe(false);
    expect(r2.isResolved).toBe(true);
    expect(r2.value).toBe(4);
    expect(innerCount).toBe(2);
    expect(outerCount).toBe(1);
  });

  describe('dependency pruning during async rerun', () => {
    test('dependencies consumed after an await are NOT disconnected when the function reruns due to being directly dirtied', async () => {
      // This test verifies that dependencies consumed after an await point are not
      // prematurely disconnected when the async function reruns.
      //
      // The bug: When an async function reruns due to a direct dirty (not MaybeDirty),
      // the synchronous part runs, then disconnectSignal is called in the finally block.
      // This disconnects any dependencies that weren't consumed yet (i.e., those after the await).

      let inner1Count = 0;
      let inner2Count = 0;
      let outerCount = 0;

      const state1 = signal(1);
      const state2 = signal(2);

      // inner1 is consumed BEFORE the await
      const inner1 = reactive(
        async () => {
          inner1Count++;
          return state1.value * 10;
        },
        { desc: 'inner1' },
      );

      // inner2 is consumed AFTER the await
      const inner2 = reactive(
        async () => {
          inner2Count++;
          return state2.value * 100;
        },
        { desc: 'inner2' },
      );

      const outer = reactive(
        async () => {
          outerCount++;
          // Consume inner1 before the await
          const val1 = await inner1();

          await sleep(10);
          // Consume inner2 after the await
          const val2 = await inner2();
          return val1 + val2;
        },
        { desc: 'outer' },
      );

      // Initial run
      const r1 = outer();
      expect(r1.isPending).toBe(true);
      await sleep(20);
      expect(r1.isResolved).toBe(true);
      expect(r1.value).toBe(210); // 1*10 + 2*100
      expect(inner1Count).toBe(1);
      expect(inner2Count).toBe(1);
      expect(outerCount).toBe(1);

      // Now directly dirty the outer function by changing state1
      // This will cause outer to rerun
      state1.value = 2;

      const r2 = outer();
      expect(r2.isPending).toBe(true);
      expect(inner1Count).toBe(2); // inner1 reran because state1 changed

      // At this point, the outer function has started its rerun:
      // - It consumed inner1 (before the await)
      // - It has NOT yet consumed inner2 (after the await)
      //
      // BUG: inner2 should NOT be disconnected/unwatched at this point,
      // but the current implementation calls disconnectSignal immediately
      // after the synchronous part completes.

      await sleep(20);
      expect(r2.isResolved).toBe(true);
      expect(r2.value).toBe(220); // 2*10 + 2*100

      // inner2 should have been reused, NOT recreated
      // If inner2 was disconnected and garbage collected, it would have been
      // recreated, causing inner2Count to increment unnecessarily
      expect(inner2Count).toBe(1); // Should still be 1 - inner2 wasn't dirtied
      expect(outerCount).toBe(2);
    });

    test('dependencies should only be pruned after async function fully resolves', async () => {
      // This test specifically checks that unused dependencies are only pruned
      // AFTER the promise has fully resolved, not during the async execution.

      let dep1Count = 0;
      let dep2Count = 0;
      let outerCount = 0;

      const useDep1 = signal(true);
      const state1 = signal(1);
      const state2 = signal(2);

      const dep1 = reactive(
        async () => {
          dep1Count++;
          return state1.value * 10;
        },
        { desc: 'dep1' },
      );

      const dep2 = reactive(
        async () => {
          dep2Count++;
          return state2.value * 100;
        },
        { desc: 'dep2' },
      );

      const outer = reactive(
        async () => {
          outerCount++;
          // First await
          const val1 = await dep1();
          await sleep(10);
          // Conditionally consume dep2 after the await
          if (useDep1.value) {
            const val2 = await dep2();
            return val1 + val2;
          }
          return val1;
        },
        { desc: 'outer' },
      );

      // Initial run with useDep1 = true
      const r1 = outer();
      await sleep(20);
      expect(r1.value).toBe(210);
      expect(dep1Count).toBe(1);
      expect(dep2Count).toBe(1);
      expect(outerCount).toBe(1);

      // Now change useDep1 to false - this dirties outer
      useDep1.value = false;

      const r2 = outer();
      expect(r2.isPending).toBe(true);

      await sleep(20);
      expect(r2.isResolved).toBe(true);
      expect(r2.value).toBe(10); // Only dep1 value now
      expect(outerCount).toBe(2);

      // dep2 should NOT have been recomputed during this rerun
      // (it wasn't consumed this time and should have been disconnected)
      expect(dep2Count).toBe(1);

      // Now change useDep1 to true again
      useDep1.value = true;

      const r3 = outer();
      expect(r3.isPending).toBe(true);

      await sleep(20);
      expect(r3.isResolved).toBe(true);
      expect(r3.value).toBe(210); // 2*10 + 2*100

      expect(dep2Count).toBe(2);
    });

    test('dependencies consumed after await should not be garbage collected during rerun', async () => {
      // This test verifies that dependencies consumed after an await don't get
      // scheduled for garbage collection during the rerun.

      let innerCount = 0;
      let outerCount = 0;

      const trigger = signal(1);
      const innerValue = signal(100);

      const inner = reactive(
        async () => {
          innerCount++;
          await nextTick();
          return innerValue.value;
        },
        { desc: 'inner' },
      );

      const outer = reactive(
        async () => {
          outerCount++;
          // Access trigger before await
          const t = trigger.value;
          await nextTick();
          // Access inner after await
          const v = await inner();
          return t + v;
        },
        { desc: 'outer' },
      );

      // Initial run
      const r1 = outer();
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(r1.value).toBe(101); // 1 + 100
      expect(innerCount).toBe(1);
      expect(outerCount).toBe(1);

      // Dirty outer by changing trigger (consumed before await)
      trigger.value = 2;

      const r2 = outer();
      expect(r2.isPending).toBe(true);

      // Wait for the async execution to complete
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(r2.value).toBe(102); // 2 + 100
      expect(outerCount).toBe(2);

      // inner should NOT have been recreated/recomputed
      // If it was garbage collected during the rerun, it would have been
      // recreated, incrementing the count
      expect(innerCount).toBe(1);

      // Now verify that inner is still properly subscribed by changing innerValue
      innerValue.value = 200;
      const r3 = outer();
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(r3.value).toBe(202); // 2 + 200
      expect(innerCount).toBe(2); // Now inner should recompute
      expect(outerCount).toBe(3);
    });

    test('multiple awaits should preserve all dependencies until promise settles', async () => {
      // Test with multiple sequential awaits to ensure all dependencies
      // are preserved until the final resolution.

      let dep1Count = 0;
      let dep2Count = 0;
      let dep3Count = 0;
      let outerCount = 0;

      const trigger = signal(0);

      const dep1 = reactive(
        async () => {
          dep1Count++;
          await nextTick();
          return 'a';
        },
        { desc: 'dep1' },
      );

      const dep2 = reactive(
        async () => {
          dep2Count++;
          await nextTick();
          return 'b';
        },
        { desc: 'dep2' },
      );

      const dep3 = reactive(
        async () => {
          dep3Count++;
          await nextTick();
          return 'c';
        },
        { desc: 'dep3' },
      );

      const outer = reactive(
        async () => {
          outerCount++;
          // Consume trigger first
          const t = trigger.value;
          // Then multiple sequential awaits
          const v1 = await dep1();
          await sleep(10);
          const v2 = await dep2();
          await sleep(10);
          const v3 = await dep3();
          await sleep(10);
          return `${t}:${v1}${v2}${v3}`;
        },
        { desc: 'outer' },
      );

      // Initial run
      const r1 = outer();
      await sleep(60);
      expect(r1.value).toBe('0:abc');
      expect(dep1Count).toBe(1);
      expect(dep2Count).toBe(1);
      expect(dep3Count).toBe(1);
      expect(outerCount).toBe(1);

      // Dirty by changing trigger
      trigger.value = 1;

      const r2 = outer();
      await sleep(60);
      expect(r2.value).toBe('1:abc');
      expect(outerCount).toBe(2);

      // All deps should have been preserved, not recreated
      expect(dep1Count).toBe(1);
      expect(dep2Count).toBe(1);
      expect(dep3Count).toBe(1);
    });

    describe('relay lifecycle during async rerun', () => {
      test('relays consumed after an await should NOT be unsubscribed when the function reruns', async () => {
        // This test verifies that relays consumed after an await point are not
        // prematurely unsubscribed when the async function reruns.
        //
        // The bug: When an async function reruns due to a direct dirty,
        // disconnectSignal is called after the synchronous part completes,
        // which would unsubscribe relays that weren't consumed yet.

        let outerCount = 0;
        const trigger = signal(1);
        const relayValue = signal(100);

        // relay1 is consumed BEFORE the await
        const relay1 = relay<number>(
          state => {
            state.value = trigger.value * 10;
            return {
              update: () => {
                state.value = trigger.value * 10;
              },
              deactivate: () => {},
            };
          },
          { desc: 'relay1' },
        );

        // relay2 is consumed AFTER the await
        const relay2 = relay<number>(
          state => {
            state.value = relayValue.value;
            return {
              update: () => {
                state.value = relayValue.value;
              },
              deactivate: () => {},
            };
          },
          { desc: 'relay2' },
        );

        // Wrap relays in reactive functions so they can be properly consumed
        const getRelay1 = reactive(
          async () => {
            return relay1.value;
          },
          { desc: 'getRelay1' },
        );

        const getRelay2 = reactive(
          async () => {
            return relay2.value;
          },
          { desc: 'getRelay2' },
        );

        const outer = reactive(
          async () => {
            outerCount++;
            // Consume relay1 before the await
            const val1 = await getRelay1();

            await sleep(10);
            // Consume relay2 after the await
            const val2 = await getRelay2();
            return val1! + val2!;
          },
          { desc: 'outer' },
        );

        // Initial run - use toHaveSignalValue which creates a watcher to activate relays
        expect(outer).toHaveSignalValue(undefined);
        await sleep(30);
        expect(outer).toHaveSignalValue(110); // 1*10 + 100
        expect(relay1).toHaveCounts({ subscribe: 1, unsubscribe: 0 });
        expect(relay2).toHaveCounts({ subscribe: 1, unsubscribe: 0 });
        expect(outerCount).toBe(1);

        // Now directly dirty outer by changing trigger (consumed via relay1 before await)
        trigger.value = 2;

        // At this point, outer has started its rerun:
        // - It consumed relay1 (before the await)
        // - It has NOT yet consumed relay2 (after the await)
        //
        // BUG: relay2 should NOT be unsubscribed at this point

        await sleep(30);
        expect(outer).toHaveSignalValue(120); // 2*10 + 100

        // relay2 should NOT have been unsubscribed and resubscribed
        expect(relay2).toHaveCounts({ subscribe: 1, unsubscribe: 0 });
        expect(outerCount).toBe(2);
      });

      test('relay consumed after plain await should not be unsubscribed during rerun', async () => {
        // This tests the specific case where there's a plain await (like sleep)
        // before consuming the relay

        let outerCount = 0;
        const trigger = signal(1);
        const relayValue = signal(100);

        const innerRelay = relay<number>(
          state => {
            state.value = relayValue.value;
            return {
              update: () => {
                state.value = relayValue.value;
              },
              deactivate: () => {},
            };
          },
          { desc: 'innerRelay' },
        );

        // Wrap relay in a reactive function for proper consumption
        const getRelay = reactive(
          async () => {
            return innerRelay.value;
          },
          { desc: 'getRelay' },
        );

        const outer = reactive(
          async () => {
            outerCount++;
            // Access trigger before await
            const t = trigger.value;
            await sleep(10);
            // Access relay after await
            const v = await getRelay();
            return t + v!;
          },
          { desc: 'outer' },
        );

        // Initial run
        expect(outer).toHaveSignalValue(undefined);
        await sleep(30);
        expect(outer).toHaveSignalValue(101); // 1 + 100
        expect(innerRelay).toHaveCounts({ subscribe: 1, unsubscribe: 0 });
        expect(outerCount).toBe(1);

        // Dirty outer by changing trigger (consumed before await)
        trigger.value = 2;

        await sleep(30);
        expect(outer).toHaveSignalValue(102); // 2 + 100
        expect(outerCount).toBe(2);

        // innerRelay should NOT have been unsubscribed during the rerun
        expect(innerRelay).toHaveCounts({ subscribe: 1, unsubscribe: 0 });

        // Now verify the relay is still properly subscribed by changing relayValue
        relayValue.value = 200;
        await sleep(30);
        expect(outer).toHaveSignalValue(202); // 2 + 200
        expect(outerCount).toBe(3);
        // Relay should have been updated, not unsubscribed/resubscribed
        expect(innerRelay).toHaveCounts({ subscribe: 1, unsubscribe: 0, update: 1 });
      });

      test('multiple relays consumed after awaits should all remain subscribed', async () => {
        // Test with multiple relays consumed at different points after awaits

        let outerCount = 0;
        const trigger = signal(0);

        const relay1 = relay<string>(
          state => {
            state.value = 'a';
            return { deactivate: () => {} };
          },
          { desc: 'relay1' },
        );

        const relay2 = relay<string>(
          state => {
            state.value = 'b';
            return { deactivate: () => {} };
          },
          { desc: 'relay2' },
        );

        const relay3 = relay<string>(
          state => {
            state.value = 'c';
            return { deactivate: () => {} };
          },
          { desc: 'relay3' },
        );

        // Wrap relays in reactive functions
        const getRelay1 = reactive(async () => relay1.value, { desc: 'getRelay1' });
        const getRelay2 = reactive(async () => relay2.value, { desc: 'getRelay2' });
        const getRelay3 = reactive(async () => relay3.value, { desc: 'getRelay3' });

        const outer = reactive(
          async () => {
            outerCount++;
            // Consume trigger first
            const t = trigger.value;
            // Then multiple sequential awaits with relays
            const v1 = await getRelay1();
            await sleep(10);
            const v2 = await getRelay2();
            await sleep(10);
            const v3 = await getRelay3();
            await sleep(10);
            return `${t}:${v1}${v2}${v3}`;
          },
          { desc: 'outer' },
        );

        // Initial run
        expect(outer).toHaveSignalValue(undefined);
        await sleep(80);
        expect(outer).toHaveSignalValue('0:abc');
        expect(relay1).toHaveCounts({ subscribe: 1, unsubscribe: 0 });
        expect(relay2).toHaveCounts({ subscribe: 1, unsubscribe: 0 });
        expect(relay3).toHaveCounts({ subscribe: 1, unsubscribe: 0 });
        expect(outerCount).toBe(1);

        // Dirty by changing trigger
        trigger.value = 1;

        await sleep(80);
        expect(outer).toHaveSignalValue('1:abc');
        expect(outerCount).toBe(2);

        // All relays should remain subscribed, not unsubscribed/resubscribed
        expect(relay1).toHaveCounts({ subscribe: 1, unsubscribe: 0 });
        expect(relay2).toHaveCounts({ subscribe: 1, unsubscribe: 0 });
        expect(relay3).toHaveCounts({ subscribe: 1, unsubscribe: 0 });
      });

      test('relay should only be unsubscribed after async function fully resolves when no longer used', async () => {
        // This test verifies that relays are only unsubscribed after the promise
        // has fully resolved, and only if they were not consumed in that run.

        let outerCount = 0;
        const useRelay = signal(true);

        const conditionalRelay = relay<number>(
          state => {
            state.value = 42;
            return {
              update: () => {},
              deactivate: () => {},
            };
          },
          { desc: 'conditionalRelay' },
        );

        const alwaysUsedRelay = relay<number>(
          state => {
            state.value = 100;
            return {
              update: () => {},
              deactivate: () => {},
            };
          },
          { desc: 'alwaysUsedRelay' },
        );

        // Wrap relays in reactive functions
        const getAlwaysRelay = reactive(async () => await alwaysUsedRelay, { desc: 'getAlwaysRelay' });
        const getConditionalRelay = reactive(async () => await conditionalRelay, { desc: 'getConditionalRelay' });

        const outer = reactive(
          async () => {
            outerCount++;
            // Always consume alwaysUsedRelay first
            const v1 = await getAlwaysRelay();
            await sleep(10);
            // Conditionally consume conditionalRelay after the await
            if (useRelay.value) {
              const v2 = await getConditionalRelay();
              return v1! + v2!;
            }
            return v1!;
          },
          { desc: 'outer' },
        );

        // Initial run with useRelay = true
        expect(outer).toHaveSignalValue(undefined);
        await sleep(50);
        expect(outer).toHaveSignalValue(142); // 100 + 42
        expect(alwaysUsedRelay).toHaveCounts({ subscribe: 1, unsubscribe: 0 });
        expect(conditionalRelay).toHaveCounts({ subscribe: 1, unsubscribe: 0 });
        expect(outerCount).toBe(1);

        // Now change useRelay to false - this dirties outer
        useRelay.value = false;

        await sleep(50);
        expect(outer).toHaveSignalValue(100); // Only alwaysUsedRelay value now
        expect(outerCount).toBe(2);

        // alwaysUsedRelay should still be subscribed
        expect(alwaysUsedRelay).toHaveCounts({ subscribe: 1, unsubscribe: 0 });

        // conditionalRelay should be unsubscribed AFTER the function fully resolved
        // (not during the async execution)
        await nextTick(); // Allow unsubscribe to be scheduled and executed
        expect(conditionalRelay).toHaveCounts({ subscribe: 1, unsubscribe: 1 });
      });

      test('relay with async value setting consumed after await should not be prematurely unsubscribed', async () => {
        // Test relay that sets its value asynchronously

        let outerCount = 0;
        const trigger = signal(1);
        const relayValue = signal(100);

        const asyncRelay = relay<number>(
          state => {
            const value = relayValue.value;
            // Simulate async initialization
            setTimeout(() => {
              state.value = value;
            }, 5);

            return {
              update: () => {
                state.value = relayValue.value;
              },
              deactivate: () => {},
            };
          },
          { desc: 'asyncRelay' },
        );

        // Wrap relay in a reactive function
        const getAsyncRelay = reactive(async () => await asyncRelay, { desc: 'getAsyncRelay' });

        const outer = reactive(
          async () => {
            outerCount++;
            const t = trigger.value;
            await sleep(10);
            // Consume async relay after await
            const v = await getAsyncRelay();
            return t + v!;
          },
          { desc: 'outer' },
        );

        // Initial run
        expect(outer).toHaveSignalValue(undefined);
        await sleep(50);
        expect(outer).toHaveSignalValue(101); // 1 + 100
        expect(asyncRelay).toHaveCounts({ subscribe: 1, unsubscribe: 0 });
        expect(outerCount).toBe(1);

        // Dirty outer by changing trigger
        trigger.value = 2;

        await sleep(50);
        expect(outer).toHaveSignalValue(102); // 2 + 100
        expect(outerCount).toBe(2);

        // asyncRelay should NOT have been unsubscribed during the rerun
        expect(asyncRelay).toHaveCounts({ subscribe: 1, unsubscribe: 0 });

        // Verify relay is still working by changing relayValue
        relayValue.value = 200;
        await sleep(50);
        expect(outer).toHaveSignalValue(202); // 2 + 200
        // Relay should have been updated, not unsubscribed/resubscribed
        expect(asyncRelay).toHaveCounts({ subscribe: 1, unsubscribe: 0, update: 1 });
      });
    });
  });
});
