import { describe, expect, test } from 'vitest';
import { signal, reactive as _reactive, reactiveSignal } from '../index.js';
import { reactive } from './utils/instrumented-hooks.js';

describe('reactive (sync)', () => {
  test('Basic computed works', () => {
    const getC = reactive((a: number, b: number) => {
      return a + b;
    });

    expect(getC.withParams(1, 2)).toHaveValueAndCounts(3, { compute: 1, get: 1 });
    expect(getC.withParams(1, 2)).toHaveValueAndCounts(3, { compute: 1, get: 2 });
    expect(getC.withParams(2, 2)).toHaveValueAndCounts(4, { compute: 1, get: 1 });
    expect(getC.withParams(2, 2)).toHaveValueAndCounts(4, { compute: 1, get: 2 });
  });

  test('Computed can throw errors', () => {
    const getC = reactive((a: number) => {
      if (a < 0) throw new Error('negative number');
      return a * 2;
    });

    expect(getC.withParams(2)).toHaveValueAndCounts(4, { compute: 1, get: 1 });
    expect(() => getC(-1)).toThrow('negative number');
  });

  describe('nesting behavior', () => {
    test('Nested computeds work', () => {
      const getInner = reactive((a: number, b: number) => {
        return a + b;
      });

      const getOuter = reactive((x: number) => {
        return getInner(x, 2) * 2;
      });

      expect(getOuter.withParams(1)).toHaveValueAndCounts(6, { compute: 1, get: 1 });
      expect(getOuter.withParams(1)).toHaveValueAndCounts(6, { compute: 1, get: 2 });
      expect(getOuter.withParams(2)).toHaveValueAndCounts(8, { compute: 1, get: 1 });
      expect(getOuter.withParams(2)).toHaveValueAndCounts(8, { compute: 1, get: 2 });
    });

    test('Nested computeds with shared state', () => {
      const sharedState = signal(1);

      const getInner = reactive((a: number) => {
        return a + sharedState.value;
      });

      const getOuter = reactive((x: number) => {
        return getInner(x) * 2;
      });

      expect(getOuter.withParams(1)).toHaveValueAndCounts(4, { compute: 1, get: 1 });
      sharedState.value = 2;
      expect(getOuter.withParams(1)).toHaveValueAndCounts(6, { compute: 2, get: 2 });
    });

    test('Deeply nested computeds maintain independence', () => {
      const getA = reactive((x: number) => {
        return x + 1;
      });

      const getB = reactive((x: number) => {
        return getA(x) * 2 + getA(x * 2);
      });

      const getC = reactive((x: number) => {
        return getB(x) + getA(x);
      });

      expect(getC.withParams(1)).toHaveValueAndCounts(9, { compute: 1, get: 1 });
      expect(getC.withParams(1)).toHaveValueAndCounts(9, { compute: 1, get: 2 });
      expect(getC.withParams(2)).toHaveValueAndCounts(14, { compute: 1, get: 1 });
      expect(getC.withParams(2)).toHaveValueAndCounts(14, { compute: 1, get: 2 });
    });

    test('Nested computeds work with state signals', () => {
      const stateA = signal(1);
      const stateB = signal(2);

      const getInner = reactive((x: number) => {
        return x + stateA.value;
      });

      const getOuter = reactive((x: number) => {
        return getInner(x) * stateB.value;
      });

      expect(getOuter.withParams(3)).toHaveValueAndCounts(8, { compute: 1, get: 1 });

      stateA.value = 2;
      expect(getOuter.withParams(3)).toHaveValueAndCounts(10, { compute: 2, get: 2 });

      stateB.value = 3;
      expect(getOuter.withParams(3)).toHaveValueAndCounts(15, { compute: 3, get: 3 });

      expect(getOuter.withParams(3)).toHaveValueAndCounts(15, { compute: 3, get: 4 });
    });

    test('Nested computeds work with both state and arguments', () => {
      const stateA = signal(1);
      const stateB = signal(2);

      const getInner = reactive((x: number, y: number) => {
        return x + y + stateA.value;
      });

      const getMiddle = reactive((x: number) => {
        return getInner(x, stateB.value) * 2;
      });

      const getOuter = reactive((x: number, y: number) => {
        return getMiddle(x) + y;
      });

      expect(getOuter.withParams(1, 3)).toHaveValueAndCounts(11, { compute: 1, get: 1 });

      stateB.value = 3;
      expect(getOuter.withParams(1, 3)).toHaveValueAndCounts(13, { compute: 2, get: 2 });

      stateA.value = 2;
      expect(getOuter.withParams(1, 3)).toHaveValueAndCounts(15, { compute: 3, get: 3 });

      expect(getOuter.withParams(1, 4)).toHaveValueAndCounts(16, { compute: 1, get: 1 });

      expect(getOuter.withParams(1, 4)).toHaveValueAndCounts(16, { compute: 1, get: 2 });
    });
  });

  test('reactive(fn) returns the same function for the same fn reference', () => {
    const fn = (a: number) => a + 1;
    const r1 = _reactive(fn);
    const r2 = _reactive(fn);

    expect(r1).toBe(r2);
  });

  test('reactive(fn) returns different functions for different fn references', () => {
    const fn1 = (a: number) => a + 1;
    const fn2 = (a: number) => a + 1;
    const r1 = _reactive(fn1);
    const r2 = _reactive(fn2);

    expect(r1).not.toBe(r2);
  });

  test('dirtying state consumed by the current function during computation is silently absorbed', () => {
    const s = signal(0);
    let computeCount = 0;

    const selfMutator = reactiveSignal(() => {
      computeCount++;
      const v = s.value;
      if (v === 0) {
        s.value = 1;
      }
      return v;
    });

    expect(selfMutator.value).toBe(0);
    expect(computeCount).toBe(1);
  });
});
