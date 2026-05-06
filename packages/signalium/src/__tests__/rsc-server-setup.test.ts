import { afterEach, describe, expect, test } from 'vitest';
import { reactive, setRequestScopeGetter } from 'signalium';
import { setupRscRequestScope } from '../react/server.js';

afterEach(() => {
  setRequestScopeGetter(undefined);
});

describe('signalium/react/server', () => {
  test('setupRscRequestScope registers a working getter (smoke)', async () => {
    setupRscRequestScope();
    const load = reactive(async () => {
      await Promise.resolve();
      return 42;
    });
    await expect(load()).resolves.toBe(42);
  });
});
