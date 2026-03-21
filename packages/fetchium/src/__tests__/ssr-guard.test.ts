import { describe, it, expect, afterEach } from 'vitest';
import { MemoryPersistentStore, SyncQueryStore } from '../stores/sync.js';
import { QueryClient } from '../QueryClient.js';
import { NoOpGcManager } from '../GcManager.js';
import { createMockFetch } from './utils.js';

/**
 * SSR Guard Tests
 *
 * Verifies that QueryClient uses no-op managers on the server
 * (when `typeof window === 'undefined'`) to prevent timer leaks.
 *
 * Note: In the Node test environment, `typeof window === 'undefined'` is true,
 * so the SSR path is the default.
 */

describe('SSR Guard', () => {
  let client: QueryClient;

  afterEach(() => {
    client?.destroy();
  });

  it('should use NoOpGcManager on the server by default', () => {
    const store = new SyncQueryStore(new MemoryPersistentStore());
    const mockFetch = createMockFetch();
    client = new QueryClient(store, { fetch: mockFetch as any });

    expect(client.isServer).toBe(true);
    expect(client.gcManager).toBeInstanceOf(NoOpGcManager);
  });

  it('should allow overriding gc manager even on the server', () => {
    const store = new SyncQueryStore(new MemoryPersistentStore());
    const mockFetch = createMockFetch();
    const customGc = new NoOpGcManager();

    client = new QueryClient(store, { fetch: mockFetch as any }, undefined, customGc);

    expect(client.gcManager).toBe(customGc);
  });

  it('should call destroy() safely without subscription manager', () => {
    const store = new SyncQueryStore(new MemoryPersistentStore());
    const mockFetch = createMockFetch();
    client = new QueryClient(store, { fetch: mockFetch as any });

    expect(() => client.destroy()).not.toThrow();
  });
});
