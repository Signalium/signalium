import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryPersistentStore, SyncQueryStore } from '../stores/sync.js';
import { QueryClient } from '../QueryClient.js';
import { t } from '../typeDefs.js';
import { RESTQuery, fetchQuery } from '../query.js';
import { createMockFetch, testWithClient, sleep } from './utils.js';

/**
 * Query Body Support Tests
 *
 * These tests verify that queries can send JSON request bodies,
 * which is useful for POST/PUT/PATCH queries that need caching, deduplication,
 * and other query features while sending complex data structures.
 */

describe('Query Body Support', () => {
  let client: QueryClient;
  let mockFetch: ReturnType<typeof createMockFetch>;

  beforeEach(() => {
    const store = new SyncQueryStore(new MemoryPersistentStore());
    mockFetch = createMockFetch();
    client = new QueryClient(store, { fetch: mockFetch as any });
  });

  afterEach(() => {
    client?.destroy();
  });

  describe('Basic Body Tests', () => {
    it('should send POST query with body only', async () => {
      mockFetch.post('/prices', {
        prices: [
          { token: 'ETH', price: 2000 },
          { token: 'BTC', price: 50000 },
        ],
      });

      class GetPrices extends RESTQuery {
        params = { tokens: t.array(t.string) };
        path = '/prices';
        method = 'POST' as const;
        body = { tokens: this.params.tokens };
        result = {
          prices: t.array(
            t.object({
              token: t.string,
              price: t.number,
            }),
          ),
        };
      }

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetPrices, { tokens: ['ETH', 'BTC'] });
        const result = await relay;

        expect(result.prices).toHaveLength(2);
        expect(result.prices[0].token).toBe('ETH');
        expect(result.prices[1].price).toBe(50000);

        // Verify request was made correctly
        expect(mockFetch.calls[0].url).toBe('/prices');
        expect(mockFetch.calls[0].options.method).toBe('POST');

        // Verify body was sent as JSON
        const body = JSON.parse(mockFetch.calls[0].options.body as string);
        expect(body.tokens).toEqual(['ETH', 'BTC']);
      });
    });

    it('should automatically set Content-Type header to application/json', async () => {
      mockFetch.post('/data', { received: true });

      class PostData extends RESTQuery {
        params = { value: t.string };
        path = '/data';
        method = 'POST' as const;
        body = { value: this.params.value };
        result = {
          received: t.boolean,
        };
      }

      await testWithClient(client, async () => {
        const relay = fetchQuery(PostData, { value: 'test' });
        await relay;

        expect(mockFetch.calls[0].options.headers).toEqual({
          'Content-Type': 'application/json',
        });
      });
    });

    it('should properly JSON stringify body with nested objects', async () => {
      mockFetch.post('/complex', { id: 1 });

      class PostComplex extends RESTQuery {
        params = {
          user: t.object({
            name: t.string,
            age: t.number,
          }),
          tags: t.array(t.string),
        };
        path = '/complex';
        method = 'POST' as const;
        body = { user: this.params.user, tags: this.params.tags };
        result = {
          id: t.number,
        };
      }

      await testWithClient(client, async () => {
        const relay = fetchQuery(PostComplex, {
          user: { name: 'Alice', age: 30 },
          tags: ['admin', 'verified'],
        });
        await relay;

        const body = JSON.parse(mockFetch.calls[0].options.body as string);
        expect(body.user).toEqual({ name: 'Alice', age: 30 });
        expect(body.tags).toEqual(['admin', 'verified']);
      });
    });

    it('should allow custom Content-Type header in requestOptions to override default', async () => {
      mockFetch.post('/custom', { ok: true });

      class PostCustom extends RESTQuery {
        params = { data: t.string };
        path = '/custom';
        method = 'POST' as const;
        body = { data: this.params.data };
        headers = {
          'Content-Type': 'application/x-custom-json',
          'X-Custom': 'value',
        };
        result = {
          ok: t.boolean,
        };
      }

      await testWithClient(client, async () => {
        const relay = fetchQuery(PostCustom, { data: 'test' });
        await relay;

        // User headers should override the default Content-Type
        expect(mockFetch.calls[0].options.headers).toEqual({
          'Content-Type': 'application/x-custom-json',
          'X-Custom': 'value',
        });
      });
    });
  });

  describe('Combination Tests: Body + Path Params', () => {
    it('should correctly route path params to URL and body fields to request body', async () => {
      mockFetch.post('/users/[id]/preferences', { success: true });

      class UpdateUserPreferences extends RESTQuery {
        params = { id: t.id, theme: t.string, language: t.string };
        path = `/users/${this.params.id}/preferences`;
        method = 'POST' as const;
        body = { theme: this.params.theme, language: this.params.language };
        result = {
          success: t.boolean,
        };
      }

      await testWithClient(client, async () => {
        const relay = fetchQuery(UpdateUserPreferences, {
          id: '123',
          theme: 'dark',
          language: 'en',
        } as any);
        const result = await relay;

        expect(result.success).toBe(true);

        // Verify path param is in URL
        expect(mockFetch.calls[0].url).toBe('/users/123/preferences');

        // Verify body fields are in request body, NOT in URL
        const body = JSON.parse(mockFetch.calls[0].options.body as string);
        expect(body.theme).toBe('dark');
        expect(body.language).toBe('en');

        // Path param should NOT be in body
        expect(body.id).toBeUndefined();
      });
    });

    it('should handle multiple path params with body', async () => {
      mockFetch.post('/orgs/[orgId]/teams/[teamId]/settings', { updated: true });

      class UpdateTeamSettings extends RESTQuery {
        params = { orgId: t.id, teamId: t.id, name: t.string, visibility: t.string };
        path = `/orgs/${this.params.orgId}/teams/${this.params.teamId}/settings`;
        method = 'POST' as const;
        body = { name: this.params.name, visibility: this.params.visibility };
        result = {
          updated: t.boolean,
        };
      }

      await testWithClient(client, async () => {
        const relay = fetchQuery(UpdateTeamSettings, {
          orgId: 'acme',
          teamId: 'engineering',
          name: 'New Team Name',
          visibility: 'private',
        } as any);
        await relay;

        // Both path params should be in URL
        expect(mockFetch.calls[0].url).toBe('/orgs/acme/teams/engineering/settings');

        // Body fields should be in request body
        const body = JSON.parse(mockFetch.calls[0].options.body as string);
        expect(body.name).toBe('New Team Name');
        expect(body.visibility).toBe('private');
        expect(body.orgId).toBeUndefined();
        expect(body.teamId).toBeUndefined();
      });
    });
  });

  describe('Combination Tests: Body + Search Params', () => {
    it('should correctly route search params to URL and body fields to request body', async () => {
      mockFetch.post('/search', {
        results: [{ id: 1, name: 'Result 1' }],
        total: 1,
      });

      class SearchItems extends RESTQuery {
        params = {
          page: t.number,
          limit: t.number,
          query: t.string,
          filters: t.array(t.string),
        };
        path = '/search';
        method = 'POST' as const;
        searchParams = { page: this.params.page, limit: this.params.limit };
        body = { query: this.params.query, filters: this.params.filters };
        result = {
          results: t.array(
            t.object({
              id: t.number,
              name: t.string,
            }),
          ),
          total: t.number,
        };
      }

      await testWithClient(client, async () => {
        const relay = fetchQuery(SearchItems, {
          page: 1,
          limit: 20,
          query: 'test query',
          filters: ['category:books', 'status:active'],
        });
        const result = await relay;

        expect(result.total).toBe(1);

        // Verify search params are in URL
        const callUrl = mockFetch.calls[0].url;
        expect(callUrl).toContain('page=1');
        expect(callUrl).toContain('limit=20');

        // Body fields should NOT be in URL
        expect(callUrl).not.toContain('query=');
        expect(callUrl).not.toContain('filters=');

        // Body fields should be in request body
        const body = JSON.parse(mockFetch.calls[0].options.body as string);
        expect(body.query).toBe('test query');
        expect(body.filters).toEqual(['category:books', 'status:active']);

        // Search params should NOT be in body
        expect(body.page).toBeUndefined();
        expect(body.limit).toBeUndefined();
      });
    });
  });

  describe('Combination Tests: Body + Path Params + Search Params', () => {
    it('should correctly route all three param types to their destinations', async () => {
      mockFetch.post('/users/[userId]/posts', {
        postId: 999,
        title: 'New Post',
      });

      class CreateUserPost extends RESTQuery {
        params = {
          userId: t.id,
          draft: t.boolean,
          notify: t.boolean,
          title: t.string,
          content: t.string,
          tags: t.array(t.string),
        };
        path = `/users/${this.params.userId}/posts`;
        method = 'POST' as const;
        searchParams = { draft: this.params.draft, notify: this.params.notify };
        body = { title: this.params.title, content: this.params.content, tags: this.params.tags };
        result = {
          postId: t.number,
          title: t.string,
        };
      }

      await testWithClient(client, async () => {
        const relay = fetchQuery(CreateUserPost, {
          userId: '42',
          draft: true,
          notify: false,
          title: 'My Post Title',
          content: 'Post content here...',
          tags: ['tech', 'programming'],
        } as any);
        const result = await relay;

        expect(result.postId).toBe(999);

        // Path param should be in URL path
        const callUrl = mockFetch.calls[0].url;
        expect(callUrl).toContain('/users/42/posts');

        // Search params should be in URL query string
        expect(callUrl).toContain('draft=true');
        expect(callUrl).toContain('notify=false');

        // Body fields should NOT be in URL
        expect(callUrl).not.toContain('title=');
        expect(callUrl).not.toContain('content=');
        expect(callUrl).not.toContain('tags=');

        // Body fields should be in request body
        const body = JSON.parse(mockFetch.calls[0].options.body as string);
        expect(body.title).toBe('My Post Title');
        expect(body.content).toBe('Post content here...');
        expect(body.tags).toEqual(['tech', 'programming']);

        // Path and search params should NOT be in body
        expect(body.userId).toBeUndefined();
        expect(body.draft).toBeUndefined();
        expect(body.notify).toBeUndefined();
      });
    });
  });

  describe('Query Features with Body', () => {
    it('should cache body queries - same body params should return cached result', async () => {
      mockFetch.post('/prices', {
        prices: [{ token: 'ETH', price: 2000 }],
      });

      class GetPrices extends RESTQuery {
        params = { tokens: t.array(t.string) };
        path = '/prices';
        method = 'POST' as const;
        body = { tokens: this.params.tokens };
        result = {
          prices: t.array(
            t.object({
              token: t.string,
              price: t.number,
            }),
          ),
        };
      }

      await testWithClient(client, async () => {
        // First call
        const relay1 = fetchQuery(GetPrices, { tokens: ['ETH'] });
        await relay1;

        // Second call with same params - should be cached
        const relay2 = fetchQuery(GetPrices, { tokens: ['ETH'] });

        // Should be the same relay instance (deduplication)
        expect(relay1).toBe(relay2);

        // Only one fetch should have been made
        expect(mockFetch.calls).toHaveLength(1);
      });
    });

    it('should create separate queries for different body params', async () => {
      mockFetch.post('/prices', { prices: [{ token: 'ETH', price: 2000 }] });
      mockFetch.post('/prices', { prices: [{ token: 'BTC', price: 50000 }] });

      class GetPrices extends RESTQuery {
        params = { tokens: t.array(t.string) };
        path = '/prices';
        method = 'POST' as const;
        body = { tokens: this.params.tokens };
        result = {
          prices: t.array(
            t.object({
              token: t.string,
              price: t.number,
            }),
          ),
        };
      }

      await testWithClient(client, async () => {
        const relay1 = fetchQuery(GetPrices, { tokens: ['ETH'] });
        const relay2 = fetchQuery(GetPrices, { tokens: ['BTC'] });

        // Should be different relay instances
        expect(relay1).not.toBe(relay2);

        const [result1, result2] = await Promise.all([relay1, relay2]);

        expect(result1.prices[0].token).toBe('ETH');
        expect(result2.prices[0].token).toBe('BTC');

        // Two fetches should have been made
        expect(mockFetch.calls).toHaveLength(2);
      });
    });

    it('should respect staleTime for body queries', async () => {
      mockFetch.post('/prices', { prices: [{ token: 'ETH', price: 2000 }] });
      mockFetch.post('/prices', { prices: [{ token: 'ETH', price: 2100 }] });

      class GetPrices extends RESTQuery {
        params = { tokens: t.array(t.string) };
        path = '/prices';
        method = 'POST' as const;
        body = { tokens: this.params.tokens };
        result = {
          prices: t.array(
            t.object({
              token: t.string,
              price: t.number,
            }),
          ),
        };
        config = {
          staleTime: 100,
        };
      }

      await testWithClient(client, async () => {
        // First call
        const relay1 = fetchQuery(GetPrices, { tokens: ['ETH'] });
        const result1 = await relay1;
        expect(result1.prices[0].price).toBe(2000);
        expect(mockFetch.calls).toHaveLength(1);

        // Immediate second call - should use cache
        const relay2 = fetchQuery(GetPrices, { tokens: ['ETH'] });
        expect(relay2).toBe(relay1);
        expect(mockFetch.calls).toHaveLength(1);
      });
    });

    it('should deduplicate identical concurrent body queries', async () => {
      mockFetch.post('/prices', { prices: [{ token: 'ETH', price: 2000 }] });

      class GetPrices extends RESTQuery {
        params = { tokens: t.array(t.string) };
        path = '/prices';
        method = 'POST' as const;
        body = { tokens: this.params.tokens };
        result = {
          prices: t.array(
            t.object({
              token: t.string,
              price: t.number,
            }),
          ),
        };
      }

      await testWithClient(client, async () => {
        // Make multiple concurrent calls with same params
        const relay1 = fetchQuery(GetPrices, { tokens: ['ETH', 'BTC'] });
        const relay2 = fetchQuery(GetPrices, { tokens: ['ETH', 'BTC'] });
        const relay3 = fetchQuery(GetPrices, { tokens: ['ETH', 'BTC'] });

        // All should be the same relay instance
        expect(relay1).toBe(relay2);
        expect(relay2).toBe(relay3);

        await Promise.all([relay1, relay2, relay3]);

        // Only one fetch should have been made
        expect(mockFetch.calls).toHaveLength(1);
      });
    });
  });

  describe('Edge Cases', () => {
    it('should work with empty body object', async () => {
      mockFetch.post('/trigger', { triggered: true });

      class TriggerAction extends RESTQuery {
        path = '/trigger';
        method = 'POST' as const;
        body = {};
        result = {
          triggered: t.boolean,
        };
      }

      await testWithClient(client, async () => {
        // Empty body means no params are required
        const relay = fetchQuery(TriggerAction);
        const result = await relay;

        expect(result.triggered).toBe(true);
        expect(mockFetch.calls[0].options.method).toBe('POST');
        // Empty body should still be sent as JSON
        expect(mockFetch.calls[0].options.body).toBe('{}');
      });
    });

    it('should handle queries without body (backward compatibility)', async () => {
      mockFetch.get('/users', { users: [] });

      class ListUsers extends RESTQuery {
        path = '/users';
        result = {
          users: t.array(t.object({ id: t.number, name: t.string })),
        };
      }

      await testWithClient(client, async () => {
        const relay = fetchQuery(ListUsers);
        const result = await relay;

        expect(result.users).toEqual([]);
        expect(mockFetch.calls[0].options.method).toBe('GET');
        // No body should be sent
        expect(mockFetch.calls[0].options.body).toBeUndefined();
        // No Content-Type header should be set for non-body requests
        expect(mockFetch.calls[0].options.headers).toBeUndefined();
      });
    });

    it('should handle body with array as root type', async () => {
      mockFetch.post('/bulk-create', { created: 3 });

      class BulkCreate extends RESTQuery {
        params = {
          items: t.array(
            t.object({
              name: t.string,
              value: t.number,
            }),
          ),
        };
        path = '/bulk-create';
        method = 'POST' as const;
        body = { items: this.params.items };
        result = {
          created: t.number,
        };
      }

      await testWithClient(client, async () => {
        const relay = fetchQuery(BulkCreate, {
          items: [
            { name: 'item1', value: 1 },
            { name: 'item2', value: 2 },
            { name: 'item3', value: 3 },
          ],
        });
        const result = await relay;

        expect(result.created).toBe(3);

        const body = JSON.parse(mockFetch.calls[0].options.body as string);
        expect(body.items).toHaveLength(3);
      });
    });

    // Note: RESTQuery API prevents param conflicts by design - params are defined once
    // and body/searchParams use refs (this.params.x). No separate conflict validation needed.
  });
});
