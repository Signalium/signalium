/* eslint-disable @typescript-eslint/no-unused-expressions */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SyncQueryStore, MemoryPersistentStore, updatedAtKeyFor } from '../QueryStore.js';
import { QueryClient } from '../QueryClient.js';
import { query } from '../query.js';
import { createMockFetch, testWithClient, sleep } from './utils.js';

/**
 * StaleTime Tests
 *
 * Tests staleTime behavior: serving cached data while refetching in background
 */

describe('StaleTime', () => {
  let client: QueryClient;
  let mockFetch: ReturnType<typeof createMockFetch>;
  let kv: any;
  let store: any;

  beforeEach(() => {
    client?.destroy();
    kv = new MemoryPersistentStore();
    store = new SyncQueryStore(kv);
    mockFetch = createMockFetch();
    client = new QueryClient(store, { fetch: mockFetch as any });
  });

  describe('Fresh Data', () => {
    it('should not refetch when data is fresh (within staleTime)', async () => {
      // Set up query with 10 second staleTime
      const getItem = query(t => ({
        path: '/item',
        response: { value: t.string },
        cache: { staleTime: 10000 }, // 10 seconds
      }));

      mockFetch.get('/item', { value: 'first' });

      await testWithClient(client, async () => {
        // First fetch
        const relay1 = getItem();
        await relay1;
        expect(relay1.value).toEqual({ value: 'first' });
        expect(mockFetch.calls).toHaveLength(1);

        // Second access immediately (data is fresh)
        mockFetch.get('/item', { value: 'second' });
        const relay2 = getItem();

        // Force evaluation
        relay2.value;
        await sleep(50);

        // Should use cached data without refetch
        expect(relay2.value).toEqual({ value: 'first' });
        expect(mockFetch.calls).toHaveLength(1); // Still only one call
      });
    });

    it('should use fresh data from disk cache without refetch', async () => {
      const getItem = query(t => ({
        path: '/item',
        response: { data: t.number },
        cache: { staleTime: 5000 },
      }));

      mockFetch.get('/item', { data: 42 });

      await testWithClient(client, async () => {
        const relay1 = getItem();
        await relay1;
        expect(mockFetch.calls).toHaveLength(1);
      });

      // Create new client with same store (simulating app restart)
      mockFetch.reset();
      mockFetch.get('/item', { data: 99 }, { delay: 50 });
      const client2 = new QueryClient(store, { fetch: mockFetch as any });

      await testWithClient(client2, async () => {
        const relay = getItem();

        // Should immediately have cached value
        relay.value;
        await sleep(10);
        expect(relay.value).toEqual({ data: 42 });

        // Should not refetch since data is still fresh
        await sleep(100);
        expect(mockFetch.calls).toHaveLength(0);
      });
    });
  });

  describe('Stale Data', () => {
    it('should serve stale data immediately while refetching in background', async () => {
      const getItem = query(t => ({
        path: '/item',
        response: { count: t.number },
        staleTime: 100, // 100ms
      }));

      mockFetch.get('/item', { count: 1 });

      await testWithClient(client, async () => {
        // Initial fetch
        const relay1 = getItem();
        await relay1;
        expect(relay1.value).toEqual({ count: 1 });
      });

      // Wait for data to become stale, and unwatch query entirely
      await sleep(200);

      await testWithClient(client, async () => {
        // Set up new response
        mockFetch.get('/item', { count: 2 }, { delay: 50 });

        // Access again - should serve stale data immediately
        const relay2 = getItem();
        relay2.value;
        await sleep(10);

        // Should have stale data immediately
        expect(relay2.value).toEqual({ count: 1 });

        // Wait for background refetch to complete
        await sleep(100);

        // Should now have fresh data
        expect(relay2.value).toEqual({ count: 2 });
        expect(mockFetch.calls).toHaveLength(2);
      });
    });

    it('should refetch stale data from disk cache', async () => {
      const getItem = query(t => ({
        path: '/data',
        response: { version: t.number },
        staleTime: 100,
      }));

      mockFetch.get('/data', { version: 1 });

      await testWithClient(client, async () => {
        const relay = getItem();
        await relay;
      });

      // Wait for data to become stale
      await sleep(150);

      // Create new client
      mockFetch.reset();
      mockFetch.get('/data', { version: 2 }, { delay: 50 });
      const client2 = new QueryClient(store, { fetch: mockFetch as any });

      await testWithClient(client2, async () => {
        const relay = getItem();

        // Should have cached value immediately
        relay.value;
        await sleep(10);
        expect(relay.value).toEqual({ version: 1 });

        // Should trigger background refetch
        await sleep(100);

        expect(relay.value).toEqual({ version: 2 });
        expect(mockFetch.calls).toHaveLength(1);
      });
    });

    it('should handle no staleTime (always refetch)', async () => {
      const getItem = query(t => ({
        path: '/item',
        response: { value: t.string },
        // No staleTime configured
      }));

      mockFetch.get('/item', { value: 'first' });

      await testWithClient(client, async () => {
        const relay1 = getItem();
        await relay1;
        expect(mockFetch.calls).toHaveLength(1);
      });

      // Access again immediately
      await testWithClient(client, async () => {
        mockFetch.get('/item', { value: 'second' }, { delay: 50 });
        const relay2 = getItem();

        relay2.value;
        await sleep(10);

        // Should have cached value
        expect(relay2.value).toEqual({ value: 'first' });

        // But should refetch in background
        await sleep(100);

        expect(relay2.value).toEqual({ value: 'second' });
        expect(mockFetch.calls).toHaveLength(2);
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle staleTime of 0 (always stale)', async () => {
      const getItem = query(t => ({
        path: '/item',
        response: { n: t.number },
        cache: { staleTime: 0 },
      }));

      mockFetch.get('/item', { n: 1 });

      await testWithClient(client, async () => {
        const relay1 = getItem();
        await relay1;
      });

      await testWithClient(client, async () => {
        mockFetch.get('/item', { n: 2 }, { delay: 50 });
        const relay2 = getItem();

        // Should serve cached but refetch immediately
        relay2.value;
        await sleep(10);
        expect(relay2.value).toEqual({ n: 1 });

        await sleep(100);
        expect(relay2.value).toEqual({ n: 2 });
      });
    });

    it('should handle very long staleTime', async () => {
      vi.useFakeTimers();

      try {
        const getItem = query(t => ({
          path: '/item',
          response: { data: t.string },
          cache: { staleTime: 1000 * 60 * 60 }, // 1 hour
        }));

        mockFetch.get('/item', { data: 'cached' });

        // First subscription - fetch initial data
        await testWithClient(client, async () => {
          const relay1 = getItem();
          await relay1;
          expect(relay1.value).toEqual({ data: 'cached' });
          expect(mockFetch.calls).toHaveLength(1);
        });

        // Unsubscribed now (testWithClient ended)

        // Second subscription - should still use cache (data is fresh)
        mockFetch.reset();
        mockFetch.get('/item', { data: 'fresh1' });
        await testWithClient(client, async () => {
          const relay2 = getItem();
          relay2.value;
          await vi.advanceTimersByTimeAsync(100);

          // Should use cached data without refetch (still fresh)
          expect(relay2.value).toEqual({ data: 'cached' });
          expect(mockFetch.calls).toHaveLength(0);
        });

        // Advance time by 30 minutes - still within 1 hour staleTime
        await vi.advanceTimersByTimeAsync(30 * 60 * 1000);

        // Third subscription - data should still be fresh
        mockFetch.reset();
        mockFetch.get('/item', { data: 'fresh2' });
        await testWithClient(client, async () => {
          const relay3 = getItem();
          relay3.value;
          await vi.advanceTimersByTimeAsync(100);

          // Should still use cached data (within 1 hour)
          expect(relay3.value).toEqual({ data: 'cached' });
          expect(mockFetch.calls).toHaveLength(0);
        });

        // Advance time past the 1 hour mark (31 more minutes = 61 minutes total)
        await vi.advanceTimersByTimeAsync(31 * 60 * 1000);

        // Fourth subscription - data should now be stale and trigger refetch
        mockFetch.reset();
        mockFetch.get('/item', { data: 'fresh-after-hour' }, { delay: 100 });
        await testWithClient(client, async () => {
          const relay4 = getItem();

          // Should serve stale data immediately
          relay4.value;
          await vi.advanceTimersByTimeAsync(10);
          expect(relay4.value).toEqual({ data: 'cached' });

          // Wait for background refetch to complete
          await vi.advanceTimersByTimeAsync(100);

          // Should now have fresh data
          expect(relay4.value).toEqual({ data: 'fresh-after-hour' });
          expect(mockFetch.calls).toHaveLength(1);
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it('should handle concurrent access to stale data', async () => {
      const getItem = query(t => ({
        path: '/item',
        response: { id: t.number },
        cache: { staleTime: 50 },
      }));

      mockFetch.get('/item', { id: 1 });

      await testWithClient(client, async () => {
        const relay1 = getItem();
        await relay1;

        await sleep(100); // Make stale
      });

      await testWithClient(client, async () => {
        mockFetch.get('/item', { id: 2 }, { delay: 100 });

        // Multiple concurrent accesses
        const relay2 = getItem();
        const relay3 = getItem();
        const relay4 = getItem();

        // All should be the same relay
        expect(relay2).toBe(relay3);
        expect(relay3).toBe(relay4);

        // Should serve stale data immediately
        relay2.value;
        await sleep(10);
        expect(relay2.value).toEqual({ id: 1 });

        // Wait for refetch
        await sleep(100);
        expect(relay2.value).toEqual({ id: 2 });

        // Should only refetch once
        expect(mockFetch.calls).toHaveLength(2);
      });
    });
  });
});
