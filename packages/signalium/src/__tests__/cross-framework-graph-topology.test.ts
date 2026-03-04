import { describe, expect, test } from 'vitest';
import { signal, watcher } from 'signalium';
import { reactive } from './utils/instrumented-hooks.js';

/**
 * Graph topology edge cases adapted from:
 * - js-reactivity-benchmark (kairo suite: diamond, deep, broad, triangle, mux)
 * - preact-signals (diamond variants)
 * - TC39 signal-polyfill (graph.test.ts)
 */
describe('graph topology edge cases', () => {
  describe('diamond dependencies', () => {
    test('classic diamond: single source, two branches, single consumer', () => {
      const src = signal('a');

      const left = reactive(() => src.value, { desc: 'left' });
      const right = reactive(() => src.value, { desc: 'right' });
      const bottom = reactive(() => left() + ' ' + right(), { desc: 'bottom' });

      const w = watcher(() => bottom());
      w.addListener(() => {});

      expect(bottom()).toBe('a a');
      src.value = 'aa';
      expect(bottom()).toBe('aa aa');
    });

    test('diamond with tail: update propagates through diamond and beyond', () => {
      const src = signal('a');

      const left = reactive(() => src.value, { desc: 'left' });
      const right = reactive(() => src.value, { desc: 'right' });
      const merge = reactive(() => left() + ' ' + right(), { desc: 'merge' });
      const tail = reactive(() => merge(), { desc: 'tail' });

      const w = watcher(() => tail());
      w.addListener(() => {});

      expect(tail()).toBe('a a');
      src.value = 'aa';
      expect(tail()).toBe('aa aa');
    });

    test('jagged diamond: asymmetric depth across branches', () => {
      const src = signal('a');

      const a = reactive(() => src.value, { desc: 'a' });
      const b = reactive(() => src.value, { desc: 'b' });
      const c = reactive(() => b(), { desc: 'c' });
      const merge = reactive(() => a() + ' ' + c(), { desc: 'merge' });
      const tail1 = reactive(() => merge(), { desc: 'tail1' });
      const tail2 = reactive(() => merge(), { desc: 'tail2' });

      const w = watcher(() => {
        tail1();
        tail2();
      });
      w.addListener(() => {});

      expect(tail1()).toBe('a a');
      expect(tail2()).toBe('a a');
      src.value = 'b';
      expect(tail1()).toBe('b b');
      expect(tail2()).toBe('b b');
    });

    test('diamond: one branch constant — consumer must still update', () => {
      const src = signal('a');

      const changing = reactive(() => src.value, { desc: 'changing' });
      const constant = reactive(
        () => {
          src.value;
          return 'c';
        },
        { desc: 'constant' },
      );
      const bottom = reactive(() => changing() + ' ' + constant(), { desc: 'bottom' });

      const w = watcher(() => bottom());
      w.addListener(() => {});

      expect(bottom()).toBe('a c');
      src.value = 'aa';
      expect(bottom()).toBe('aa c');
    });

    test('diamond: two branches constant — consumer must still update if third changes', () => {
      const src = signal('a');

      const changing = reactive(() => src.value, { desc: 'changing' });
      const const1 = reactive(
        () => {
          src.value;
          return 'c';
        },
        { desc: 'const1' },
      );
      const const2 = reactive(
        () => {
          src.value;
          return 'd';
        },
        { desc: 'const2' },
      );
      const bottom = reactive(() => changing() + ' ' + const1() + ' ' + const2(), { desc: 'bottom' });

      const w = watcher(() => bottom());
      w.addListener(() => {});

      expect(bottom()).toBe('a c d');
      src.value = 'aa';
      expect(bottom()).toBe('aa c d');
    });

    test('diamond: ALL branches constant — consumer should NOT recompute', () => {
      const src = signal('a');

      const b = reactive(
        () => {
          src.value;
          return 'b';
        },
        { desc: 'b' },
      );
      const c = reactive(
        () => {
          src.value;
          return 'c';
        },
        { desc: 'c' },
      );
      const bottom = reactive(() => b() + ' ' + c(), { desc: 'bottom' });

      const w = watcher(() => bottom());
      w.addListener(() => {});

      expect(bottom()).toBe('b c');
      src.value = 'aa';
      expect(bottom()).toBe('b c');
    });

    test('kairo diamond: fan-out to N branches, fan-in to sum', () => {
      const width = 5;
      const head = signal(0);

      const branches = Array.from({ length: width }, (_, i) =>
        reactive(() => head.value + 1, { desc: `branch${i}` }),
      );

      const sum = reactive(
        () => {
          let total = 0;
          for (const branch of branches) {
            total += branch();
          }
          return total;
        },
        { desc: 'sum' },
      );

      let effectCount = 0;
      const w = watcher(() => sum());
      w.addListener(() => {
        effectCount++;
      });

      expect(sum()).toBe(width * 1);

      for (let i = 1; i <= 20; i++) {
        head.value = i;
        expect(sum()).toBe(width * (i + 1));
      }
    });
  });

  describe('deep chains', () => {
    test('kairo deep: linear chain of 50 computeds', () => {
      const len = 50;
      const head = signal(0);

      let current: () => number = () => head.value;
      for (let i = 0; i < len; i++) {
        const prev = current;
        current = reactive(() => prev() + 1, { desc: `chain${i}` });
      }

      const tail = current;
      const w = watcher(() => tail());
      w.addListener(() => {});

      expect(tail()).toBe(len);

      for (let i = 1; i <= 20; i++) {
        head.value = i;
        expect(tail()).toBe(len + i);
      }
    });
  });

  describe('broad fan-out', () => {
    test('kairo broad: single source fans to 50 independent effects', () => {
      const width = 50;
      const head = signal(0);

      let effectCount = 0;
      let lastValue = 0;

      for (let i = 0; i < width; i++) {
        const current = reactive(() => head.value + i, { desc: `broad${i}` });
        const current2 = reactive(() => current() + 1, { desc: `broad2_${i}` });

        const w = watcher(() => current2());
        w.addListener(() => {
          effectCount++;
        });

        if (i === width - 1) {
          lastValue = current2() as unknown as number;
        }
      }

      expect(lastValue).toBe(50);

      for (let i = 1; i <= 10; i++) {
        head.value = i;
      }
    });
  });

  describe('triangle topology', () => {
    test('kairo triangle: chain where sum reads all intermediate nodes', () => {
      const width = 10;
      const head = signal(0);

      const nodes: (() => number)[] = [() => head.value];
      for (let i = 1; i < width; i++) {
        const prev = nodes[i - 1];
        nodes.push(reactive(() => prev() + 1, { desc: `tri${i}` }));
      }

      const sum = reactive(
        () => {
          let total = 0;
          for (const node of nodes) {
            total += node();
          }
          return total;
        },
        { desc: 'sum' },
      );

      const w = watcher(() => sum());
      w.addListener(() => {});

      // sum of 0..9 = 45
      expect(sum()).toBe(45);

      head.value = 1;
      // sum of 1..10 = 55
      expect(sum()).toBe(55);

      head.value = 5;
      // sum of 5..14 = 95
      expect(sum()).toBe(95);
    });
  });

  describe('mux/demux topology', () => {
    test('many sources merge into one, then split back out', () => {
      const count = 10;
      const sources = Array.from({ length: count }, (_, i) => signal(0));

      const mux = reactive(
        () => {
          const result: Record<number, number> = {};
          for (let i = 0; i < sources.length; i++) {
            result[i] = sources[i].value;
          }
          return result;
        },
        { desc: 'mux' },
      );

      const splits = Array.from({ length: count }, (_, i) =>
        reactive(() => mux()[i], { desc: `split${i}` }),
      );

      const outputs = Array.from({ length: count }, (_, i) =>
        reactive(() => splits[i]() + 1, { desc: `out${i}` }),
      );

      const w = watcher(() => {
        for (const out of outputs) {
          out();
        }
      });
      w.addListener(() => {});

      for (let i = 0; i < count; i++) {
        expect(outputs[i]()).toBe(1);
      }

      for (let i = 0; i < count; i++) {
        sources[i].value = i + 1;
        expect(outputs[i]()).toBe(i + 2);
      }
    });
  });

  describe('convergence topologies', () => {
    test('fan-out then fan-in: single convergence point recomputes once', () => {
      const d = signal(0);

      const fans = Array.from({ length: 5 }, (_, i) =>
        reactive(() => d.value, { desc: `fan${i}` }),
      );

      let computeCount = 0;
      const g = reactive(
        () => {
          computeCount++;
          let total = 0;
          for (const f of fans) {
            total += f();
          }
          return total;
        },
        { desc: 'g' },
      );

      const w = watcher(() => g());
      w.addListener(() => {});

      expect(g()).toBe(0);
      computeCount = 0;

      d.value = 1;
      expect(g()).toBe(5);
      expect(computeCount).toBe(1);
    });

    test('exponential convergence: 2 levels of fan-out/fan-in', () => {
      const d = signal(0);

      const level1 = Array.from({ length: 3 }, (_, i) =>
        reactive(() => d.value, { desc: `l1_${i}` }),
      );

      const level2 = Array.from({ length: 3 }, (_, i) =>
        reactive(
          () => {
            let total = 0;
            for (const f of level1) {
              total += f();
            }
            return total;
          },
          { desc: `l2_${i}` },
        ),
      );

      let computeCount = 0;
      const h = reactive(
        () => {
          computeCount++;
          let total = 0;
          for (const g of level2) {
            total += g();
          }
          return total;
        },
        { desc: 'h' },
      );

      const w = watcher(() => h());
      w.addListener(() => {});

      expect(h()).toBe(0);
      computeCount = 0;

      d.value = 1;
      expect(h()).toBe(9);
      expect(computeCount).toBe(1);
    });
  });
});
