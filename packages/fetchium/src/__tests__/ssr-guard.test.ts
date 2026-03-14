import { describe, it, expect, afterEach } from 'vitest';
import { MemoryPersistentStore, SyncQueryStore } from '../stores/sync.js';
import { QueryClient } from '../QueryClient.js';
import { NoOpRefetchManager } from '../RefetchManager.js';
import { NoOpMemoryEvictionManager } from '../MemoryEvictionManager.js';
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

  it('should use NoOpRefetchManager on the server by default', () => {
    const store = new SyncQueryStore(new MemoryPersistentStore());
    const mockFetch = createMockFetch();
    client = new QueryClient(store, { fetch: mockFetch as any });

    // In Node (unit tests), typeof window === 'undefined', so isServer is true
    expect(client.isServer).toBe(true);
    expect(client.refetchManager).toBeInstanceOf(NoOpRefetchManager);
  });

  it('should use NoOpMemoryEvictionManager on the server by default', () => {
    const store = new SyncQueryStore(new MemoryPersistentStore());
    const mockFetch = createMockFetch();
    client = new QueryClient(store, { fetch: mockFetch as any });

    expect(client.isServer).toBe(true);
    expect(client.memoryEvictionManager).toBeInstanceOf(NoOpMemoryEvictionManager);
  });

  it('should allow overriding managers even on the server', () => {
    const store = new SyncQueryStore(new MemoryPersistentStore());
    const mockFetch = createMockFetch();
    const customRefetch = new NoOpRefetchManager();
    const customEviction = new NoOpMemoryEvictionManager();

    client = new QueryClient(store, { fetch: mockFetch as any }, undefined, customEviction, customRefetch);

    expect(client.refetchManager).toBe(customRefetch);
    expect(client.memoryEvictionManager).toBe(customEviction);
  });

  it('should call destroy() safely on no-op managers', () => {
    const store = new SyncQueryStore(new MemoryPersistentStore());
    const mockFetch = createMockFetch();
    client = new QueryClient(store, { fetch: mockFetch as any });

    // Should not throw
    expect(() => client.destroy()).not.toThrow();
  });
});
