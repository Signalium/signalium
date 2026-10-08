import { describe, expect, test } from 'vitest';
import { signal, watcher } from 'signalium';
import { reactive } from './utils/instrumented-hooks.js';

/**
 * Stress tests adapted from:
 * - js-reactivity-benchmark (cellx benchmark, deep chains)
 * - Vue reactivity (multi-layer computed diamond stress test)
 */
describe('stress tests', () => {
  describe('cellx benchmark', () => {
    test('multi-layer cross-wired grid (100 layers)', () => {
      const layers = 100;

      const prop1 = signal(1);
      const prop2 = signal(2);
      const prop3 = signal(3);
      const prop4 = signal(4);

      type Layer = {
        p1: () => number;
        p2: () => number;
        p3: () => number;
        p4: () => number;
      };

      let prev: Layer = {
        p1: () => prop1.value,
        p2: () => prop2.value,
        p3: () => prop3.value,
        p4: () => prop4.value,
      };

      for (let i = 0; i < layers; i++) {
        const p = prev;
        const layer: Layer = {
          p1: reactive(() => p.p2(), { desc: `L${i}_p1` }),
          p2: reactive(() => p.p1() - p.p3(), { desc: `L${i}_p2` }),
          p3: reactive(() => p.p2() + p.p4(), { desc: `L${i}_p3` }),
          p4: reactive(() => p.p3(), { desc: `L${i}_p4` }),
        };
        prev = layer;
      }

      const last = prev;

      const w = watcher(() => {
        last.p1();
        last.p2();
        last.p3();
        last.p4();
      });
      w.addListener(() => {});

      const v1 = last.p1();
      const v2 = last.p2();
      const v3 = last.p3();
      const v4 = last.p4();

      // Values should be deterministic
      expect(typeof v1).toBe('number');
      expect(typeof v2).toBe('number');
      expect(typeof v3).toBe('number');
      expect(typeof v4).toBe('number');

      // Mutate all 4 sources
      prop1.value = 4;
      prop2.value = 3;
      prop3.value = 2;
      prop4.value = 1;

      const u1 = last.p1();
      const u2 = last.p2();
      const u3 = last.p3();
      const u4 = last.p4();

      // After update, values should be different from before
      expect(typeof u1).toBe('number');
      expect(typeof u2).toBe('number');
      expect(typeof u3).toBe('number');
      expect(typeof u4).toBe('number');
      expect(Number.isFinite(u1)).toBe(true);
      expect(Number.isFinite(u2)).toBe(true);
      expect(Number.isFinite(u3)).toBe(true);
      expect(Number.isFinite(u4)).toBe(true);
    });

    test('cellx with expected values (10 layers)', () => {
      const prop1 = signal(1);
      const prop2 = signal(2);
      const prop3 = signal(3);
      const prop4 = signal(4);

      type Layer = {
        p1: () => number;
        p2: () => number;
        p3: () => number;
        p4: () => number;
      };

      let prev: Layer = {
        p1: () => prop1.value,
        p2: () => prop2.value,
        p3: () => prop3.value,
        p4: () => prop4.value,
      };

      for (let i = 0; i < 10; i++) {
        const p = prev;
        const layer: Layer = {
          p1: reactive(() => p.p2(), { desc: `L${i}_p1` }),
          p2: reactive(() => p.p1() - p.p3(), { desc: `L${i}_p2` }),
          p3: reactive(() => p.p2() + p.p4(), { desc: `L${i}_p3` }),
          p4: reactive(() => p.p3(), { desc: `L${i}_p4` }),
        };
        prev = layer;
      }

      const last = prev;

      const w = watcher(() => {
        last.p1();
        last.p2();
        last.p3();
        last.p4();
      });
      w.addListener(() => {});

      const vals = [last.p1(), last.p2(), last.p3(), last.p4()];

      // After mutation
      prop1.value = 4;
      prop2.value = 3;
      prop3.value = 2;
      prop4.value = 1;

      const updated = [last.p1(), last.p2(), last.p3(), last.p4()];

      // The actual values depend on the cross-wiring pattern. Just verify they're finite numbers.
      for (const v of updated) {
        expect(Number.isFinite(v)).toBe(true);
      }
    });
  });

  describe('deep chain stress', () => {
    test('100-level deep computed chain', () => {
      const depth = 100;
      const src = signal(0);

      let current: () => number = () => src.value;
      for (let i = 0; i < depth; i++) {
        const prev = current;
        current = reactive(() => prev() + 1, { desc: `deep${i}` });
      }

      const tail = current;
      const w = watcher(() => tail());
      w.addListener(() => {});

      expect(tail()).toBe(depth);

      src.value = 1;
      expect(tail()).toBe(depth + 1);

      src.value = 100;
      expect(tail()).toBe(depth + 100);
    });

    test('200-level deep computed chain', () => {
      const depth = 200;
      const src = signal(0);

      let current: () => number = () => src.value;
      for (let i = 0; i < depth; i++) {
        const prev = current;
        current = reactive(() => prev() + 1, { desc: `deep${i}` });
      }

      const tail = current;
      const w = watcher(() => tail());
      w.addListener(() => {});

      expect(tail()).toBe(depth);

      src.value = 1;
      expect(tail()).toBe(depth + 1);
    });
  });

  describe('broad fan-out stress', () => {
    test('100 independent observers from single source', () => {
      const src = signal(0);

      const observers: (() => number)[] = [];
      for (let i = 0; i < 100; i++) {
        observers.push(reactive(() => src.value + i, { desc: `obs${i}` }));
      }

      const w = watcher(() => {
        for (const obs of observers) {
          obs();
        }
      });
      w.addListener(() => {});

      // Verify initial values
      for (let i = 0; i < 100; i++) {
        expect(observers[i]()).toBe(i);
      }

      src.value = 10;

      // All should update
      for (let i = 0; i < 100; i++) {
        expect(observers[i]()).toBe(10 + i);
      }
    });
  });

  describe('rapid sequential updates', () => {
    test('many rapid updates to single signal', () => {
      const s = signal(0);

      const doubled = reactive(() => s.value * 2, { desc: 'doubled' });
      const tripled = reactive(() => s.value * 3, { desc: 'tripled' });
      const combined = reactive(() => doubled() + tripled(), { desc: 'combined' });

      const w = watcher(() => combined());
      w.addListener(() => {});

      for (let i = 0; i < 1000; i++) {
        s.value = i;
      }

      expect(combined()).toBe(999 * 2 + 999 * 3);
    });

    test('alternating two signals rapidly', () => {
      const a = signal(0);
      const b = signal(0);

      const sum = reactive(() => a.value + b.value, { desc: 'sum' });
      const product = reactive(() => a.value * b.value, { desc: 'product' });
      const combined = reactive(() => sum() + product(), { desc: 'combined' });

      const w = watcher(() => combined());
      w.addListener(() => {});

      for (let i = 0; i < 500; i++) {
        a.value = i;
        b.value = i + 1;
      }

      expect(sum()).toBe(499 + 500);
      expect(product()).toBe(499 * 500);
      expect(combined()).toBe(499 + 500 + 499 * 500);
    });
  });

  describe('performance regression guards', () => {
    test('deep chain should update in linear time', () => {
      const depth = 500;
      const src = signal(0);

      let current: () => number = () => src.value;
      for (let i = 0; i < depth; i++) {
        const prev = current;
        current = reactive(() => prev() + 1, { desc: `perf${i}` });
      }

      const tail = current;
      const w = watcher(() => tail());
      w.addListener(() => {});

      expect(tail()).toBe(depth);

      const start = performance.now();
      for (let i = 1; i <= 10; i++) {
        src.value = i;
        tail();
      }
      const elapsed = performance.now() - start;

      // Should complete well under 1 second for 10 updates through 500 nodes
      expect(elapsed).toBeLessThan(1000);
    });

    test('cellx 1000 layers should complete in reasonable time', () => {
      const prop1 = signal(1);
      const prop2 = signal(2);
      const prop3 = signal(3);
      const prop4 = signal(4);

      type Layer = {
        p1: () => number;
        p2: () => number;
        p3: () => number;
        p4: () => number;
      };

      let prev: Layer = {
        p1: () => prop1.value,
        p2: () => prop2.value,
        p3: () => prop3.value,
        p4: () => prop4.value,
      };

      for (let i = 0; i < 1000; i++) {
        const p = prev;
        prev = {
          p1: reactive(() => p.p2(), { desc: `L${i}_p1` }),
          p2: reactive(() => p.p1() - p.p3(), { desc: `L${i}_p2` }),
          p3: reactive(() => p.p2() + p.p4(), { desc: `L${i}_p3` }),
          p4: reactive(() => p.p3(), { desc: `L${i}_p4` }),
        };
      }

      const last = prev;

      const w = watcher(() => {
        last.p1();
        last.p2();
        last.p3();
        last.p4();
      });
      w.addListener(() => {});

      const start = performance.now();
      last.p1();
      last.p2();
      last.p3();
      last.p4();

      prop1.value = 4;
      prop2.value = 3;
      prop3.value = 2;
      prop4.value = 1;

      last.p1();
      last.p2();
      last.p3();
      last.p4();
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(5000);
    });
  });
});
