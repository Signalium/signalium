import { describe, expect, test } from 'vitest';
import { context, getContext, withContexts, signal, setGlobalContexts } from '../index.js';
import { permute } from './utils/permute.js';
import { nextTick } from './utils/async.js';
import { reactive } from './utils/instrumented-hooks.js';

describe('contexts', () => {
  test('throws when useContext is used outside of a signal', () => {
    expect(() => {
      getContext(context('test'));
    }).toThrow('getContext must be used within a reactive function');
  });

  test('setGlobalContexts sets contexts at the root level', () => {
    const value = signal('Hello');
    const ctx = context(value);
    const override = signal('Hey');

    // Create a reactive function that uses the context
    const derived = reactive(() => `${getContext(ctx).value}, World`);

    // Initially should use default value
    expect(derived()).toBe('Hello, World');

    // Set root contexts
    setGlobalContexts([[ctx, override]]);

    // Should now use the override value
    expect(derived()).toBe('Hey, World');

    // Changes to override should be reflected
    override.value = 'Hi';
    expect(derived()).toBe('Hi, World');
  });

  test('setGlobalContexts with multiple contexts', () => {
    const value1 = signal('Hello');
    const value2 = signal('World');
    const context1 = context(value1);
    const context2 = context(value2);
    const override1 = signal('Hey');
    const override2 = signal('There');

    const derived = reactive(() => `${getContext(context1).value}, ${getContext(context2).value}`);

    // Initially should use default values
    expect(derived()).toBe('Hello, World');

    // Set multiple root contexts
    setGlobalContexts([
      [context1, override1],
      [context2, override2],
    ]);

    expect(derived()).toBe('Hey, There');

    // Changes to overrides should be reflected
    override1.value = 'Hi';
    override2.value = 'Everyone';
    expect(derived()).toBe('Hi, Everyone');

    // Changes to original values should not affect the result
    value1.value = 'Bye';
    value2.value = 'Earth';
    expect(derived()).toBe('Hi, Everyone');
  });

  test('withContexts inherits from root scope', () => {
    const defaultValue1 = signal('default1');
    const defaultValue2 = signal('default2');
    const ctx1 = context(defaultValue1);
    const ctx2 = context(defaultValue2);
    const rootOverride1 = signal('root1');
    const rootOverride2 = signal('root2');

    // Set root contexts
    setGlobalContexts([
      [ctx1, rootOverride1],
      [ctx2, rootOverride2],
    ]);

    // Create a reactive function that uses both contexts
    const derived = reactive(() => `${getContext(ctx1).value}-${getContext(ctx2).value}`);

    // Should inherit from root scope when no local overrides
    const result1 = withContexts([], () => derived());
    expect(result1).toBe('root1-root2');

    // Should inherit from root scope for unoverridden contexts
    const localOverride1 = signal('local1');
    const result2 = withContexts([[ctx1, localOverride1]], () => derived());
    expect(result2).toBe('local1-root2');

    // Should use local overrides when provided
    const localOverride2 = signal('local2');
    const result3 = withContexts(
      [
        [ctx1, localOverride1],
        [ctx2, localOverride2],
      ],
      () => derived(),
    );
    expect(result3).toBe('local1-local2');

    // Changes to root contexts should be reflected in inherited contexts
    rootOverride1.value = 'updated-root1';
    rootOverride2.value = 'updated-root2';

    const result4 = withContexts([], () => derived());
    expect(result4).toBe('updated-root1-updated-root2');

    const result5 = withContexts([[ctx1, localOverride1]], () => derived());
    expect(result5).toBe('local1-updated-root2');
  });

  test('async computed maintains context ownership across await boundaries', async () => {
    const ctx = context('default');

    const promise = Promise.resolve('promise-value');

    const inner = reactive(async () => {
      await Promise.resolve();
      return 'inner-value';
    });

    const outer = reactive(async () => {
      const result = await inner();

      // Use context after awaiting inner result
      const contextValue = getContext(ctx);
      return result + '-' + contextValue;
    });

    // Test in parent scope
    expect(outer).toHaveValueAndCounts(undefined, { compute: 1 });

    // Wait for async computation to complete
    await nextTick();
    await nextTick();
    expect(outer).toHaveValueAndCounts('inner-value-default', { compute: 1 });

    // Test in child scope
    expect(outer.withContexts([ctx, 'child'])).toHaveValueAndCounts(undefined, { compute: 1 });

    // Verify parent scope maintains separate computed
    await nextTick();
    await nextTick();

    expect(outer.withContexts([ctx, 'child'])).toHaveValueAndCounts('inner-value-child', { compute: 1 });
    expect(outer).toHaveValueAndCounts('inner-value-default', { compute: 1 });
  });

  test('async task maintains context ownership across await boundaries', async () => {
    const ctx = context('default');

    const task = reactive(async () => {
      await Promise.resolve();
    });
  });

  permute(1, create => {
    test('computed signals are cached per context scope', async () => {
      const ctx = context('default');
      const value = signal(0);

      const computed = create(
        () => {
          return getContext(ctx) + value.value;
        },
        {
          desc: 'relay',
        },
      );

      computed();

      await nextTick();

      // Same scope should reuse computation
      expect(computed).toHaveSignalValue('default0').toMatchSnapshot();
      expect(computed).toHaveSignalValue('default0').toMatchSnapshot();

      const result = withContexts([[ctx, 'other']], () => {
        // Different scope should compute again
        return computed();
      });

      await nextTick();

      expect(computed.withContexts([ctx, 'other']))
        .toHaveSignalValue('other0')
        .toMatchSnapshot();
      expect(computed.withContexts([ctx, 'other']))
        .toHaveSignalValue('other0')
        .toMatchSnapshot();

      expect(computed).toHaveSignalValue('default0').toMatchSnapshot();
    });
  });

  permute(2, (create1, create2) => {
    test('contexts are properly scoped', async () => {
      const ctx = context('default');

      const computed1 = create1(() => {
        return getContext(ctx);
      });

      computed1.watch();

      await nextTick();

      expect(computed1).toHaveSignalValue('default').toMatchSnapshot();

      const computed2 = create2(() => {
        return withContexts([[ctx, 'override']], () => {
          return computed1();
        });
      });

      computed2.watch();

      await nextTick();

      expect(computed2).toHaveSignalValue('override').toMatchSnapshot();
      // expect(computed1).toHaveSignalValue('default').toMatchSnapshot();
    });

    test('context scopes inherit from parent scope when nested in computeds', async () => {
      const ctx1 = context('default1');
      const ctx2 = context('default2');

      const computed1 = create1(() => {
        return getContext(ctx1) + getContext(ctx2);
      });

      const computed2 = create2(() => {
        return (
          getContext(ctx2) +
          withContexts([[ctx2, ':inner-override2']], () => {
            return computed1();
          })
        );
      });

      computed2.watch();
      computed2.withContexts([ctx1, 'override1']).watch();
      computed2.withContexts([ctx2, 'override2']).watch();
      computed2.withContexts([ctx1, 'override1'], [ctx2, 'override2']).watch();

      await nextTick();

      expect(computed2).toHaveSignalValue('default2default1:inner-override2').toMatchSnapshot();
      expect(computed1).toMatchSnapshot();

      expect(computed2.withContexts([ctx1, 'override1']))
        .toHaveSignalValue('default2override1:inner-override2')
        .toMatchSnapshot();
      expect(computed1).toMatchSnapshot();

      await nextTick();

      expect(computed2.withContexts([ctx1, 'override1'], [ctx2, 'override2']))
        .toHaveSignalValue('override2override1:inner-override2')
        .toMatchSnapshot();
      expect(computed1).toMatchSnapshot();

      expect(computed2.withContexts([ctx2, 'override2']))
        .toHaveSignalValue('override2default1:inner-override2')
        .toMatchSnapshot();
      expect(computed1).toMatchSnapshot();
    });
  });
});
