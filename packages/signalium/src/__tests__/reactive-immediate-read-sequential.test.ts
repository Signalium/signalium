import { describe, expect, test } from 'vitest';
import { signal } from 'signalium';
import { reactive } from './utils/instrumented-hooks.js';
import { nextTick } from './utils/async.js';

describe('reactive async immediate read after sequential writes', () => {
  test('outer awaits inner and reflects sequential writes immediately', async () => {
    const animals = signal<string[]>([]);

    const getRaw = reactive(
      async () => {
        // Introduce an async boundary that resolves next microtask
        const s = animals.value;
        await nextTick();
        return s;
      },
      { desc: 'getRaw' },
    );

    const getRaw1 = reactive(
      async () => {
        const s = await getRaw();
        return s;
      },
      { desc: 'getRaw1' },
    );

    const getRaw2 = reactive(
      async () => {
        const s = await getRaw1();
        return s;
      },
      { desc: 'getRaw2' },
    );

    const write = (k: string) => {
      const curr = animals.value;
      animals.value = [...curr, k];
    };

    // 1) first write
    write('cat');
    let items = await getRaw2();
    expect(items).toContain('cat');

    // 2) second write
    write('dog');
    items = await getRaw2();
    expect(items).toContain('dog');

    // 3) third write — this has been observed to intermittently fail
    write('fish');
    items = await getRaw2();
    expect(items).toContain('fish');
  });
});
