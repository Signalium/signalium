import { describe, expect, test } from 'vitest';
import { context, getContext, withContexts, signal } from '../index.js';
import { reactive } from './utils/instrumented-hooks.js';
import { nextTick } from './utils/async.js';

describe('callback + reactive scope/identity', () => {
  test('reactive called in a callback defined in a reactive function has the correct scope (via contexts)', async () => {
    const ctx = context('default');

    const inner = reactive(() => {
      return getContext(ctx);
    });

    const makeCb = reactive(() => {
      return () => inner();
    });

    // Callback created in default/root scope captures default context
    const cbDefault = makeCb();
    expect(cbDefault()).toBe('default');

    // Callback created in child scope captures child context even when invoked elsewhere
    const cbChild = makeCb.withContexts([ctx, 'child'])();
    expect(cbChild()).toBe('child');

    // Invoking in a different ambient scope should still use captured scope
    const result = withContexts([[ctx, 'other']], () => cbChild());
    expect(result).toBe('child');

    await nextTick();
  });

  test('reactive called via nested callbacks maintains correct scope across multiple levels', async () => {
    const ctx = context('default');

    const inner = reactive(() => getContext(ctx));

    const makeNestedCb = reactive(() => {
      // two levels of nested callbacks
      return () => () => inner();
    });

    // Create nested callback in child scope
    const outerCb = makeNestedCb.withContexts([ctx, 'child'])();
    const innerCb = outerCb();

    expect(innerCb()).toBe('child');

    // Even if invoked under a different ambient scope, captured scope is preserved
    const result = withContexts([[ctx, 'other']], () => innerCb());
    expect(result).toBe('child');

    await nextTick();
  });

  test('reactive called in a callback is not tracked as a dependency by the outer reactive', async () => {
    const st = signal(1);

    const inner = reactive(() => st.value);

    const outer = reactive(
      () => {
        return () => inner();
      },
      { desc: 'outer' },
    );

    const cb = outer();

    // Outer computed once to create the callback
    expect(outer).toHaveCounts({ compute: 1 });
    expect(cb()).toBe(1);

    // Update state used only by inner; outer should NOT recompute
    st.value = 2;
    await nextTick();

    expect(outer).toHaveCounts({ compute: 1 });
    expect(cb()).toBe(2);
  });

  test('callback updates when deps change; receivers recompute only when callback identity changes', async () => {
    const toggle = signal(true);
    const unrelated = signal(0);

    const receiver = reactive(
      (fn: (n: number) => number) => {
        return fn(10);
      },
      { desc: 'receiver' },
    );

    const makeCb = reactive(
      () => {
        // Track unrelated to cause outer recompute without changing callback identity
        void unrelated.value;
        const local = toggle.value ? 1 : 2;
        return (n: number) => n + local;
      },
      { desc: 'makeCb' },
    );

    const parent = reactive(
      () => {
        return receiver(makeCb());
      },
      { desc: 'parent' },
    );

    // Initial
    expect(parent).toHaveValueAndCounts(11, { compute: 1 });
    expect(makeCb).toHaveCounts({ compute: 1 });

    // Change unrelated: outer recomputes but callback deps unchanged -> same identity -> receiver/parent should not recompute
    unrelated.value = 1;
    await nextTick();

    expect(makeCb).toHaveCounts({ compute: 2 });
    expect(parent).toHaveCounts({ compute: 1 });

    // Change toggle -> local changes -> callback deps change -> new identity -> receiver/parent recompute
    toggle.value = false;
    await nextTick();

    expect(parent).toHaveValueAndCounts(12, { compute: 2 });
    expect(makeCb).toHaveCounts({ compute: 3 });
  });

  test('async callbacks maintain their captured scope across await boundaries', async () => {
    const ctx = context('default');

    const makeAsyncCb = reactive(() => {
      return async () => {
        await nextTick();
        return getContext(ctx);
      };
    });

    // Default scope
    const cbDefault = makeAsyncCb();
    expect(await cbDefault()).toBe('default');

    // Captured child scope persists after await
    const cbChild = makeAsyncCb.withContexts([ctx, 'child'])();
    expect(await cbChild()).toBe('child');

    // Invocation under another ambient scope still returns captured child value post-await
    const result = withContexts([[ctx, 'other']], () => cbChild());
    expect(await result).toBe('child');
  });
});
