import { describe, expect, test } from 'vitest';
import { signal } from 'signalium';
import { reactive } from './utils/instrumented-hooks.js';
import { nextTick } from './utils/async.js';

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
});
