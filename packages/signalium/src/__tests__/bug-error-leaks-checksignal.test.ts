import { describe, expect, test } from 'vitest';
import { signal } from 'signalium';
import { reactive } from './utils/instrumented-hooks.js';

describe('Bug: errors from dependencies leak through checkSignal, bypassing consumer try/catch', () => {
  test('consumer with try/catch should catch errors from throwing dependency', () => {
    const shouldThrow = signal(false);
    const value = signal(0);

    const maybeThrow = reactive(
      () => {
        if (shouldThrow.value) throw new Error('dependency error');
        return value.value;
      },
      { desc: 'maybeThrow' },
    );

    const downstream = reactive(
      () => {
        try {
          return maybeThrow();
        } catch {
          return -1;
        }
      },
      { desc: 'downstream' },
    );

    // Initially no error
    expect(downstream()).toBe(0);

    // Transition to throwing — downstream's try/catch should handle it.
    // checkSignal(downstream) recursively calls checkSignal(maybeThrow)
    // at get.ts:100. When maybeThrow throws, the error propagates out
    // of checkSignal(downstream) BEFORE downstream's compute function
    // (which has the try/catch) ever executes.
    shouldThrow.value = true;
    expect(downstream()).toBe(-1); // FAILS: error leaks unhandled

    // Recovery after error clears
    shouldThrow.value = false;
    value.value = 42;
    expect(downstream()).toBe(42);
  });
});
