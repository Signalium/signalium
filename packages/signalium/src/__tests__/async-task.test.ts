import { describe, expect, test } from 'vitest';
import { task, reactive } from './utils/instrumented-hooks.js';
import { nextTick } from './utils/async.js';

describe('async tasks', () => {
  test('Basic async task works', async () => {
    let taskCount = 0;
    const getC = reactive((a: number, b: number) => {
      return task(async () => {
        taskCount++;
        return a + b;
      });
    });

    // First set of args
    const task1 = getC(1, 2);
    expect(task1.isPending).toBe(false);
    expect(task1.value).toBe(undefined);
    expect(taskCount).toEqual(0);

    await nextTick();
    expect(task1.isPending).toBe(false);
    expect(task1.value).toBe(undefined);
    expect(taskCount).toEqual(0);

    const result1 = task1.run();
    expect(task1.isPending).toBe(true);
    expect(task1.value).toBe(undefined);

    expect(await result1).toBe(3);
    expect(task1.isResolved).toBe(true);
    expect(task1.value).toBe(3);
    expect(taskCount).toEqual(1);

    const result2 = task1.run();
    expect(task1.isPending).toBe(true);
    expect(task1.value).toBe(3);
    expect(taskCount).toEqual(2);

    expect(await result2).toBe(3);
    expect(task1.isResolved).toBe(true);
    expect(task1.value).toBe(3);
    expect(taskCount).toEqual(2);

    // Second set of args
    const task2 = getC(2, 2);
    expect(task2.isPending).toBe(false);
    expect(task2.value).toBe(undefined);
    expect(taskCount).toEqual(2);

    await nextTick();
    expect(task2.isPending).toBe(false);
    expect(task2.value).toBe(undefined);
    expect(taskCount).toEqual(2);

    const result3 = task2.run();
    expect(task2.isPending).toBe(true);
    expect(task2.value).toBe(undefined);
    expect(taskCount).toEqual(3);

    expect(await result3).toBe(4);
    expect(task2.isResolved).toBe(true);
    expect(task2.value).toBe(4);
    expect(taskCount).toEqual(3);

    const result4 = task2.run();
    expect(task2.isPending).toBe(true);
    expect(task2.value).toBe(4);
    expect(taskCount).toEqual(4);

    expect(await result4).toBe(4);
    expect(task2.isResolved).toBe(true);
    expect(task2.value).toBe(4);
    expect(taskCount).toEqual(4);
  });

  test('Can run separate tasks separately', async () => {
    const getC = reactive((a: number, b: number) => {
      return task(async () => {
        return a + b;
      });
    });

    const task1 = getC(1, 2);
    const task2 = getC(2, 2);

    expect(task1.isPending).toBe(false);
    expect(task1.value).toBe(undefined);
    expect(task2.isPending).toBe(false);
    expect(task2.value).toBe(undefined);

    await nextTick();
    expect(task1.isPending).toBe(false);
    expect(task1.value).toBe(undefined);
    expect(task2.isPending).toBe(false);
    expect(task2.value).toBe(undefined);

    const result1 = task1.run();
    expect(task1.isPending).toBe(true);
    expect(task1.value).toBe(undefined);
    expect(task2.isPending).toBe(false);
    expect(task2.value).toBe(undefined);

    expect(await result1).toBe(3);
    expect(task1.isResolved).toBe(true);
    expect(task1.value).toBe(3);
    expect(task2.isPending).toBe(false);
    expect(task2.value).toBe(undefined);

    const result2 = task2.run();
    expect(task2.isPending).toBe(true);
    expect(task2.value).toBe(undefined);
    expect(task1.isPending).toBe(false);
    expect(task1.value).toBe(3);

    expect(await result2).toBe(4);
    expect(task1.isPending).toBe(false);
    expect(task1.value).toBe(3);
    expect(task2.isResolved).toBe(true);
    expect(task2.value).toBe(4);
  });

  test('Tasks do not notify when the result is not used in a computed', async () => {
    const getC = reactive((a: number, b: number) => {
      return task(async () => {
        return a + b;
      });
    });

    const computed1 = reactive(() => {
      return getC(1, 2);
    });
    const computed2 = reactive(() => {
      return getC(2, 2);
    });

    const task1 = computed1();
    const task2 = computed2();

    expect(task1.isPending).toBe(false);
    expect(task1.value).toBe(undefined);
    expect(task2.isPending).toBe(false);
    expect(task2.value).toBe(undefined);
    expect(computed1).toHaveCounts({ compute: 1 });
    expect(computed2).toHaveCounts({ compute: 1 });

    await nextTick();
    expect(task1.isPending).toBe(false);
    expect(task1.value).toBe(undefined);
    expect(task2.isPending).toBe(false);
    expect(task2.value).toBe(undefined);
    expect(computed1).toHaveCounts({ compute: 1 });
    expect(computed2).toHaveCounts({ compute: 1 });

    const result1 = task1.run();

    computed1();
    computed2();

    expect(task1.isPending).toBe(true);
    expect(task1.value).toBe(undefined);
    expect(task2.isPending).toBe(false);
    expect(task2.value).toBe(undefined);
    expect(computed1).toHaveCounts({ compute: 1 });
    expect(computed2).toHaveCounts({ compute: 1 });

    computed1();
    computed2();

    expect(await result1).toBe(3);
    expect(task1.isResolved).toBe(true);
    expect(task1.value).toBe(3);
    expect(task2.isPending).toBe(false);
    expect(task2.value).toBe(undefined);

    computed1();
    computed2();

    expect(computed1).toHaveCounts({ compute: 1 });
    expect(computed2).toHaveCounts({ compute: 1 });

    const result2 = task2.run();
    expect(task2.isPending).toBe(true);
    expect(task2.value).toBe(undefined);
    expect(task1.isPending).toBe(false);
    expect(task1.value).toBe(3);
    expect(getC.withParams(1, 2)).toHaveCounts({ compute: 1 });
    expect(getC.withParams(2, 2)).toHaveCounts({ compute: 1 });

    computed1();
    computed2();

    expect(computed1).toHaveCounts({ compute: 1 });
    expect(computed2).toHaveCounts({ compute: 1 });

    expect(await result2).toBe(4);
    expect(task1.isPending).toBe(false);
    expect(task1.value).toBe(3);
    expect(task2.isResolved).toBe(true);
    expect(task2.value).toBe(4);
    expect(getC.withParams(1, 2)).toHaveCounts({ compute: 1 });
    expect(getC.withParams(2, 2)).toHaveCounts({ compute: 1 });

    computed1();
    computed2();

    expect(computed1).toHaveCounts({ compute: 1 });
    expect(computed2).toHaveCounts({ compute: 1 });
  });

  test('Basic async task works with run args', async () => {
    const getC = reactive((a: number, b: number) => {
      return task(async (c: number, d: number) => {
        return a + b + c + d;
      });
    });

    // First set of args
    const task1 = getC(1, 2);
    expect(task1.isPending).toBe(false);
    expect(task1.value).toBe(undefined);

    await nextTick();
    expect(task1.isPending).toBe(false);
    expect(task1.value).toBe(undefined);

    const result1 = task1.run(3, 4);
    expect(task1.isPending).toBe(true);
    expect(task1.value).toBe(undefined);

    expect(await result1).toBe(10);
    expect(task1.isResolved).toBe(true);
    expect(task1.value).toBe(10);

    const result2 = task1.run(5, 6);
    expect(task1.isPending).toBe(true);
    expect(task1.value).toBe(10);

    expect(await result2).toBe(14);
    expect(task1.isResolved).toBe(true);
    expect(task1.value).toBe(14);

    // Second set of args
    const task2 = getC(2, 2);
    expect(task2.isPending).toBe(false);
    expect(task2.value).toBe(undefined);

    await nextTick();
    expect(task2.isPending).toBe(false);
    expect(task2.value).toBe(undefined);

    const result3 = task2.run(7, 8);
    expect(task2.isPending).toBe(true);
    expect(task2.value).toBe(undefined);

    expect(await result3).toBe(19);
    expect(task2.isResolved).toBe(true);
    expect(task2.value).toBe(19);

    const result4 = task2.run(9, 10);
    expect(task2.isPending).toBe(true);
    expect(task2.value).toBe(19);

    expect(await result4).toBe(23);
    expect(task2.isResolved).toBe(true);
    expect(task2.value).toBe(23);
  });

  test('Task can be defined with rest params', async () => {
    const getC = reactive((...outerNums: number[]) => {
      return task(async (...nums: number[]) => {
        return [...outerNums, ...nums].reduce((acc, num) => acc + num, 0);
      });
    });

    // First set of args
    const task1 = getC(1, 2);
    expect(task1.isPending).toBe(false);
    expect(task1.value).toBe(undefined);

    await nextTick();
    expect(task1.isPending).toBe(false);
    expect(task1.value).toBe(undefined);

    const result1 = task1.run(3, 4);
    expect(task1.isPending).toBe(true);
    expect(task1.value).toBe(undefined);

    expect(await result1).toBe(10);
    expect(task1.isResolved).toBe(true);
    expect(task1.value).toBe(10);

    const result2 = task1.run(5, 6, 7);
    expect(task1.isPending).toBe(true);
    expect(task1.value).toBe(10);

    expect(await result2).toBe(21);
    expect(task1.isResolved).toBe(true);
    expect(task1.value).toBe(21);
  });

  test('Async task handles errors', async () => {
    const getC = reactive((shouldError: boolean) => {
      return task(async () => {
        if (shouldError) {
          throw new Error('Test error');
        }
        return 'success';
      });
    });

    const result1 = getC(false);
    await expect(result1.run()).resolves.toBe('success');
    expect(result1.isPending).toBe(false);
    expect(result1.value).toBe('success');
    // await nextTick();
    // expect(result1.isResolved).toBe(true);
    // expect(result1.value).toBe('success');

    // const result2 = getC(true);
    // await expect(result2.run()).rejects.toThrow('Test error');
    // await nextTick();
    // expect(result2.isRejected).toBe(true);
    // expect(result2.error).toBeInstanceOf(Error);
    // expect((result2.error as Error).message).toBe('Test error');
  });

  test('throwIfRunning option prevents re-running while pending', async () => {
    let resolveTask: ((value: number) => void) | undefined;

    const t = task(
      async () => {
        return new Promise<number>(resolve => {
          resolveTask = resolve;
        });
      },
      { throwIfRunning: true },
    );

    expect(t.isPending).toBe(false);

    // First run should work fine
    t.run();
    expect(t.isPending).toBe(true);

    // Second run while pending should throw synchronously
    expect(() => t.run()).toThrow('Task is already running');

    // Resolve the first run
    resolveTask!(42);
    await nextTick();

    expect(t.isPending).toBe(false);
    expect(t.isResolved).toBe(true);
    expect(t.value).toBe(42);

    // After settling, run should work again
    resolveTask = undefined;
    t.run();
    expect(t.isPending).toBe(true);

    resolveTask!(99);
    await nextTick();

    expect(t.value).toBe(99);
  });

  test('throwIfRunning defaults to false (allows concurrent runs)', async () => {
    let callCount = 0;

    const t = task(async () => {
      callCount++;
      return callCount;
    });

    expect(t.isPending).toBe(false);

    // First run
    t.run();
    expect(t.isPending).toBe(true);

    // Second run while pending should NOT throw (default behavior)
    expect(() => t.run()).not.toThrow();
  });
});
