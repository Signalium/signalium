import { describe, it, expect, vi } from 'vitest';
import { reactive } from '../index.js';
import { isReactivePromise, setReactivePromise } from '../internals/async.js';

describe('isReactivePromise', () => {
  // Every async signal creates promises, and Hermes walks each WeakSet entry on every young GC.
  it('recognizes reactive promises without adding each one to a WeakSet', async () => {
    const add = vi.spyOn(WeakSet.prototype, 'add');
    const load = reactive(async (id: number) => id);
    const promises = [load(1), load(2), load(3)];
    const adds = add.mock.calls.length;
    add.mockRestore();

    expect(adds).toBe(0);
    expect(promises.every(promise => isReactivePromise(promise))).toBe(true);
    expect(await Promise.all(promises)).toEqual([1, 2, 3]);
  });

  it('still recognizes values marked with setReactivePromise', () => {
    const marked = {};
    expect(isReactivePromise(marked)).toBe(false);
    setReactivePromise(marked);
    expect(isReactivePromise(marked)).toBe(true);
  });
});
