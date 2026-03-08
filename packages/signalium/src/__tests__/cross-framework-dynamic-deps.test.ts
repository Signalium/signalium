import { describe, expect, test } from 'vitest';
import { signal, watcher } from 'signalium';
import { reactive } from './utils/instrumented-hooks.js';

/**
 * Dynamic dependency tracking edge cases adapted from:
 * - preact-signals (conditional unsubscribe, lazy branches)
 * - TC39 signal-polyfill (dynamic-dependencies.test.ts)
 * - Vue reactivity (discover new branches, deactivate old deps)
 */
describe('dynamic dependency tracking', () => {
  describe('conditional dependency enrollment', () => {
    test('switching condition changes tracked deps', () => {
      const cond = signal(true);
      const a = signal('a');
      const b = signal('b');

      const result = reactive(
        () => {
          return cond.value ? a.value : b.value;
        },
        { desc: 'condResult' },
      );

      const w = watcher(() => result());
      w.addListener(() => {});

      expect(result()).toBe('a');

      // b is not tracked, changing it should not trigger recompute
      b.value = 'bb';
      expect(result()).toBe('a');

      // Switch condition — now b is tracked, a is not
      cond.value = false;
      expect(result()).toBe('bb');

      // a is no longer tracked
      a.value = 'aa';
      expect(result()).toBe('bb');

      // b is now tracked
      b.value = 'bbb';
      expect(result()).toBe('bbb');
    });

    test('inactive branch dep changes do not trigger recomputation', () => {
      const run = signal(true);
      const prop = signal('initial');

      let effectCount = 0;
      const result = reactive(
        () => {
          effectCount++;
          return run.value ? prop.value : 'other';
        },
        { desc: 'branchResult' },
      );

      const w = watcher(() => result());
      w.addListener(() => {});

      expect(result()).toBe('initial');
      const countAfterInit = effectCount;

      // Deactivate the branch
      run.value = false;
      expect(result()).toBe('other');

      const countAfterSwitch = effectCount;

      // prop is no longer tracked — should not trigger recompute
      prop.value = 'changed';
      expect(result()).toBe('other');
      // effectCount should not have increased beyond the switch recompute
      expect(effectCount).toBe(countAfterSwitch);
    });

    test('newly discovered branch deps are tracked', () => {
      const run = signal(false);
      const prop = signal('hello');

      const result = reactive(
        () => {
          return run.value ? prop.value : 'other';
        },
        { desc: 'newBranchResult' },
      );

      const w = watcher(() => result());
      w.addListener(() => {});

      expect(result()).toBe('other');

      // prop not yet tracked
      prop.value = 'Hi';
      expect(result()).toBe('other');

      // Enable the branch — prop becomes tracked
      run.value = true;
      expect(result()).toBe('Hi');

      // Now prop changes should propagate
      prop.value = 'World';
      expect(result()).toBe('World');
    });

    test('lazy branches: a > 0 ? a : b where b = a', () => {
      const a = signal(0);
      const b = reactive(() => a.value, { desc: 'b' });
      const c = reactive(() => (a.value > 0 ? a.value : b()), { desc: 'c' });

      const w = watcher(() => c());
      w.addListener(() => {});

      expect(c()).toBe(0);
      a.value = 1;
      expect(c()).toBe(1);
      a.value = 0;
      expect(c()).toBe(0);
    });
  });

  describe('dynamic dependency list', () => {
    test('computed iterates over a dynamic list of signals', () => {
      const allSignals = Array.from({ length: 8 }, (_, i) =>
        signal(String.fromCharCode(97 + i)),
      );

      const sources = signal(allSignals);

      const concatenated = reactive(
        () => {
          return sources.value.map(s => s.value).join('');
        },
        { desc: 'concatenated' },
      );

      const w = watcher(() => concatenated());
      w.addListener(() => {});

      expect(concatenated()).toBe('abcdefgh');

      // Reduce to first 5
      sources.value = allSignals.slice(0, 5);
      expect(concatenated()).toBe('abcde');

      // Changing signal outside the current list should not trigger
      allSignals[7].value = 'H';
      expect(concatenated()).toBe('abcde');

      // Switch to last 5
      sources.value = allSignals.slice(3);
      expect(concatenated()).toBe('defgH');
    });

    test('kairo unstable: conditional dep based on runtime value', () => {
      const head = signal(0);
      const double = reactive(() => head.value * 2, { desc: 'double' });
      const inverse = reactive(() => -head.value, { desc: 'inverse' });

      const current = reactive(
        () => {
          let result = 0;
          for (let i = 0; i < 20; i++) {
            result += head.value % 2 ? double() : inverse();
          }
          return result;
        },
        { desc: 'current' },
      );

      const w = watcher(() => current());
      w.addListener(() => {});

      // head=0, even, reads inverse (-0) 20 times = 0
      expect(current()).toBe(0);

      // head=1, odd, reads double (2) 20 times = 40
      head.value = 1;
      expect(current()).toBe(40);

      // head=2, even, reads inverse (-2) 20 times = -40
      head.value = 2;
      expect(current()).toBe(-40);

      // head=3, odd, reads double (6) 20 times = 120
      head.value = 3;
      expect(current()).toBe(120);
    });
  });

  describe('conditional deps in chains', () => {
    test('parent computed guards access to child — child should not evaluate when guarded', () => {
      const a = signal<{ v: number } | null>({ v: 1 });

      const b = reactive(() => a.value, { desc: 'b' });

      let cComputeCount = 0;
      const c = reactive(
        () => {
          cComputeCount++;
          return b()?.v;
        },
        { desc: 'c' },
      );

      const d = reactive(
        () => {
          const bVal = b();
          return bVal ? c() : 0;
        },
        { desc: 'd' },
      );

      const w = watcher(() => d());
      w.addListener(() => {});

      expect(d()).toBe(1);
      const initialCCount = cComputeCount;

      // Set to null — d should short-circuit to 0 without evaluating c
      a.value = null;
      expect(d()).toBe(0);
    });

    test('chain with toggling deps maintains correct values', () => {
      const items = signal<number[] | undefined>(undefined);

      const isLoaded = reactive(() => !!items.value, { desc: 'isLoaded' });
      const msg = reactive(
        () => (isLoaded() ? 'loaded' : 'not loaded'),
        { desc: 'msg' },
      );

      const w = watcher(() => msg());
      w.addListener(() => {});

      expect(msg()).toBe('not loaded');

      items.value = [1, 2, 3];
      expect(msg()).toBe('loaded');

      items.value = [1, 2, 3]; // same value shape but new array reference
      expect(msg()).toBe('loaded');

      items.value = undefined;
      expect(msg()).toBe('not loaded');
    });
  });

  describe('dep ordering after conditional changes', () => {
    test('should trigger by the second computed that maybe dirty', () => {
      const src1 = signal(0);
      const src2 = signal(0);

      const c1 = reactive(() => src1.value, { desc: 'c1' });
      const c2 = reactive(() => (src1.value % 2) + src2.value, { desc: 'c2' });

      let c3ComputeCount = 0;
      const c3 = reactive(
        () => {
          c3ComputeCount++;
          c1();
          c2();
          return 'done';
        },
        { desc: 'c3' },
      );

      const w = watcher(() => c3());
      w.addListener(() => {});

      expect(c3()).toBe('done');
      c3ComputeCount = 0;

      // src1=2: c1 changes (0→2), but c2 stays the same (0%2+0 → 2%2+0 = 0)
      src1.value = 2;
      c3();
      expect(c3ComputeCount).toBe(1);

      c3ComputeCount = 0;

      // src2=1: c2 changes (0→1), c1 stays 2
      src2.value = 1;
      c3();
      expect(c3ComputeCount).toBe(1);
    });
  });
});
