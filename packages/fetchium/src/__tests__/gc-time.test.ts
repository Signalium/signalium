/* eslint-disable @typescript-eslint/no-unused-expressions */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SyncQueryStore, MemoryPersistentStore } from '../stores/sync.js';
import { QueryClient } from '../QueryClient.js';
import { RESTQuery, fetchQuery, queryKeyForClass } from '../query.js';
import { t } from '../typeDefs.js';
import { Entity } from '../proxy.js';
import { createMockFetch, testWithClient, sleep } from './utils.js';
import { hashValue } from 'signalium/utils';
import { valueKeyFor } from '../stores/shared.js';
import { GcManager } from '../GcManager.js';

/**
 * GC Time Tests
 *
 * Tests:
 *  - cacheTime (disk expiration, formerly gcTime, now in minutes)
 *  - gcTime (in-memory eviction via GcManager, minute-based buckets)
 *  - Entity ref counting and eviction
 */

describe('cacheTime (disk expiration)', () => {
  let client: QueryClient;
  let mockFetch: ReturnType<typeof createMockFetch>;
  let kv: any;
  let store: any;

  beforeEach(() => {
    kv = new MemoryPersistentStore();
    store = new SyncQueryStore(kv);
    mockFetch = createMockFetch();
    client = new QueryClient(store, { fetch: mockFetch as any, evictionMultiplier: 0.001 });
    client.gcManager = new GcManager(client['handleEviction'], 0.001);
  });

  afterEach(() => {
    client?.destroy();
  });

  it('should evict queries from disk after cacheTime expires', async () => {
    class GetItem extends RESTQuery {
      static cache = { cacheTime: 100 / 60_000 };
      params = { id: t.id };
      path = `/item/${this.params.id}`;
      result = { id: t.number, name: t.string };
      config = { staleTime: 50, gcTime: 1 };
    }

    mockFetch.get('/item/1', { id: 1, name: 'Item 1' });

    await testWithClient(client, async () => {
      const relay = fetchQuery(GetItem, { id: '1' });
      expect(relay.value).toEqual(undefined);
      await relay;
      expect(relay.value!).toMatchObject({ id: 1, name: 'Item 1' });
    });

    await sleep(75);

    mockFetch.get('/item/1', { id: 1, name: 'Item 1 updated' }, { delay: 50 });
    await testWithClient(client, async () => {
      const relay = fetchQuery(GetItem, { id: '1' });
      expect(relay.value!).toMatchObject({ id: 1, name: 'Item 1' });
      await relay;
      expect(relay.value!).toMatchObject({ id: 1, name: 'Item 1' });

      await sleep(60);
      expect(relay.value!).toMatchObject({ id: 1, name: 'Item 1 updated' });
    });

    await sleep(200);

    await testWithClient(client, async () => {
      const relay = fetchQuery(GetItem, { id: '1' });
      expect(relay.value).toEqual(undefined);
      await relay;
      expect(relay.value!).toMatchObject({ id: 1, name: 'Item 1 updated' });
    });
  });

  it('should NOT evict queries with active subscribers', async () => {
    class GetItem extends RESTQuery {
      static cache = { cacheTime: 50 / 60_000 };
      path = '/active';
      result = { data: t.string };
    }

    mockFetch.get('/active', { data: 'test' });

    await testWithClient(client, async () => {
      const relay = fetchQuery(GetItem);
      await relay;

      const queryKey = queryKeyForClass(GetItem, undefined);

      await sleep(60);

      expect(client.queryInstances.has(queryKey)).toBe(true);
    });
  }, 3000);
});

describe('GC Time (in-memory eviction)', () => {
  let client: QueryClient;
  let mockFetch: ReturnType<typeof createMockFetch>;
  let kv: any;
  let store: any;

  beforeEach(() => {
    kv = new MemoryPersistentStore();
    store = new SyncQueryStore(kv);
    mockFetch = createMockFetch();
    client = new QueryClient(store, { fetch: mockFetch as any, evictionMultiplier: 0.001 });
    client.gcManager = new GcManager(client['handleEviction'], 0.001);
  });

  afterEach(() => {
    client?.destroy();
  });

  it('should evict queries from memory after gcTime bucket rotates', async () => {
    class GetItem extends RESTQuery {
      path = '/gc-item';
      result = { value: t.string };
      config = { gcTime: 1 }; // 1 minute → ~60ms at 0.001 multiplier
    }

    mockFetch.get('/gc-item', { value: 'test' });

    const queryKey = queryKeyForClass(GetItem, undefined);

    await testWithClient(client, async () => {
      const relay = fetchQuery(GetItem);
      await relay;
      expect(client.queryInstances.has(queryKey)).toBe(true);
    });

    // Deactivated → scheduled in nextFlush. Wait for two rotations (2 × 60ms).
    expect(client.queryInstances.has(queryKey)).toBe(true);
    await sleep(150);
    expect(client.queryInstances.has(queryKey)).toBe(false);
  });

  it('should cancel eviction when reactivated before bucket fires', async () => {
    class GetItem extends RESTQuery {
      path = '/reactivate';
      result = { n: t.number };
      config = { gcTime: 1 };
    }

    mockFetch.get('/reactivate', { n: 1 });

    const queryKey = queryKeyForClass(GetItem, undefined);

    await testWithClient(client, async () => {
      const relay = fetchQuery(GetItem);
      await relay;
    });

    // Scheduled for eviction
    await sleep(30);

    // Reactivate before eviction fires
    mockFetch.get('/reactivate', { n: 2 });
    await testWithClient(client, async () => {
      const relay = fetchQuery(GetItem);
      relay.value;
      await sleep(40);

      expect(client.queryInstances.has(queryKey)).toBe(true);

      // Even well past original gcTime, should still be alive
      await sleep(150);
      expect(client.queryInstances.has(queryKey)).toBe(true);
    });
  });

  it('should evict on next tick when gcTime is 0', async () => {
    class GetItem extends RESTQuery {
      path = '/instant-gc';
      result = { v: t.number };
      config = { gcTime: 0 };
    }

    mockFetch.get('/instant-gc', { v: 42 });

    const queryKey = queryKeyForClass(GetItem, undefined);

    await testWithClient(client, async () => {
      const relay = fetchQuery(GetItem);
      await relay;
    });

    // gcTime: 0 → setTimeout(0) flush
    expect(client.queryInstances.has(queryKey)).toBe(true);
    await sleep(10);
    expect(client.queryInstances.has(queryKey)).toBe(false);
  });

  it('should never evict when gcTime is Infinity', async () => {
    class GetItem extends RESTQuery {
      path = '/forever';
      result = { data: t.string };
      config = { gcTime: Infinity };
    }

    mockFetch.get('/forever', { data: 'persisted' });

    const queryKey = queryKeyForClass(GetItem, undefined);

    await testWithClient(client, async () => {
      const relay = fetchQuery(GetItem);
      await relay;
    });

    // Even after generous wait, should never be evicted
    await sleep(200);
    expect(client.queryInstances.has(queryKey)).toBe(true);
  });

  it('should use separate buckets for different gcTime values', async () => {
    class FastQuery extends RESTQuery {
      path = '/fast';
      result = { x: t.number };
      config = { gcTime: 1 }; // ~60ms at 0.001
    }

    class SlowQuery extends RESTQuery {
      path = '/slow';
      result = { y: t.number };
      config = { gcTime: 2 }; // ~120ms at 0.001
    }

    mockFetch.get('/fast', { x: 1 });
    mockFetch.get('/slow', { y: 2 });

    const fastKey = queryKeyForClass(FastQuery, undefined);
    const slowKey = queryKeyForClass(SlowQuery, undefined);

    await testWithClient(client, async () => {
      await fetchQuery(FastQuery);
      await fetchQuery(SlowQuery);
    });

    // After 150ms the fast bucket should have fired twice, slow once (nextFlush only)
    await sleep(150);
    expect(client.queryInstances.has(fastKey)).toBe(false);
    expect(client.queryInstances.has(slowKey)).toBe(true);

    // After another 150ms the slow bucket should also fire
    await sleep(200);
    expect(client.queryInstances.has(slowKey)).toBe(false);
  });
});

describe('GC with Entities', () => {
  let client: QueryClient;
  let mockFetch: ReturnType<typeof createMockFetch>;
  let kv: any;
  let store: any;

  beforeEach(() => {
    kv = new MemoryPersistentStore();
    store = new SyncQueryStore(kv);
    mockFetch = createMockFetch();
    client = new QueryClient(store, { fetch: mockFetch as any, evictionMultiplier: 0.001 });
    client.gcManager = new GcManager(client['handleEviction'], 0.001);
  });

  afterEach(() => {
    client?.destroy();
  });

  it('should evict entities from memory when query is GCd', async () => {
    class Post extends Entity {
      __typename = t.typename('Post');
      id = t.id;
      title = t.string;
    }

    class User extends Entity {
      __typename = t.typename('User');
      id = t.id;
      name = t.string;
      post = t.entity(Post);
    }

    class GetUser extends RESTQuery {
      path = '/user';
      result = { user: t.entity(User) };
      config = { gcTime: 1 };
    }

    mockFetch.get('/user', {
      user: {
        __typename: 'User',
        id: 1,
        name: 'Alice',
        post: {
          __typename: 'Post',
          id: 10,
          title: 'Test Post',
        },
      },
    });

    const userKey = hashValue(['User', 1]);
    const postKey = hashValue(['Post', 10]);

    await testWithClient(client, async () => {
      const relay = fetchQuery(GetUser);
      await relay;

      expect(client.entityMap.getEntity(userKey)).toBeDefined();
      expect(client.entityMap.getEntity(postKey)).toBeDefined();
    });

    // After query is GC'd, entities with no other references should also be removed
    await sleep(200);
    expect(client.queryInstances.has(queryKeyForClass(GetUser, undefined))).toBe(false);
    expect(client.entityMap.getEntity(userKey)).toBeUndefined();
    expect(client.entityMap.getEntity(postKey)).toBeUndefined();
  });

  it('should keep entities alive when referenced by multiple queries', async () => {
    class User extends Entity {
      __typename = t.typename('SharedUser');
      id = t.id;
      name = t.string;
    }

    class GetUser1 extends RESTQuery {
      path = '/user1';
      result = { user: t.entity(User) };
      config = { gcTime: 1 };
    }

    class GetUser2 extends RESTQuery {
      path = '/user2';
      result = { user: t.entity(User) };
      config = { gcTime: 1 };
    }

    const sharedUserData = { __typename: 'SharedUser', id: 42, name: 'Bob' };
    mockFetch.get('/user1', { user: sharedUserData });
    mockFetch.get('/user2', { user: sharedUserData });

    const userKey = hashValue(['SharedUser', 42]);

    // Activate both queries
    await testWithClient(client, async () => {
      await fetchQuery(GetUser1);
      await fetchQuery(GetUser2);

      expect(client.entityMap.getEntity(userKey)).toBeDefined();
    });

    // Both deactivated. After GC of both queries, entity should finally be removed.
    await sleep(200);
    expect(client.entityMap.getEntity(userKey)).toBeUndefined();
  });

  it('should respect entity-level gcTime before removing', async () => {
    class DelayedEntity extends Entity {
      static cache = { gcTime: 2 }; // 2 minutes → ~120ms at 0.001

      __typename = t.typename('Delayed');
      id = t.id;
      value = t.string;
    }

    class GetDelayed extends RESTQuery {
      path = '/delayed';
      result = { item: t.entity(DelayedEntity) };
      config = { gcTime: 1 }; // query GC is faster
    }

    mockFetch.get('/delayed', {
      item: { __typename: 'Delayed', id: 1, value: 'hello' },
    });

    const entityKey = hashValue(['Delayed', 1]);

    await testWithClient(client, async () => {
      await fetchQuery(GetDelayed);
      expect(client.entityMap.getEntity(entityKey)).toBeDefined();
    });

    // Query should be evicted quickly (~120ms), but entity stays because it has gcTime: 2
    await sleep(200);
    expect(client.queryInstances.has(queryKeyForClass(GetDelayed, undefined))).toBe(false);
    expect(client.entityMap.getEntity(entityKey)).toBeDefined();

    // Eventually the entity's own GC bucket fires
    await sleep(300);
    expect(client.entityMap.getEntity(entityKey)).toBeUndefined();
  });

  it('should cancel entity GC when re-referenced by a new query', async () => {
    class CancelEntity extends Entity {
      static cache = { gcTime: 2 }; // 2 minutes → ~120ms at 0.001

      __typename = t.typename('CancelEnt');
      id = t.id;
      name = t.string;
    }

    class GetCancel1 extends RESTQuery {
      path = '/cancel1';
      result = { item: t.entity(CancelEntity) };
      config = { gcTime: 1 };
    }

    class GetCancel2 extends RESTQuery {
      path = '/cancel2';
      result = { item: t.entity(CancelEntity) };
      config = { gcTime: 1 };
    }

    const entityData = { __typename: 'CancelEnt', id: 1, name: 'test' };
    mockFetch.get('/cancel1', { item: entityData });
    mockFetch.get('/cancel2', { item: entityData });

    const entityKey = hashValue(['CancelEnt', 1]);

    // First query fetches entity, then deactivates
    await testWithClient(client, async () => {
      await fetchQuery(GetCancel1);
      expect(client.entityMap.getEntity(entityKey)).toBeDefined();
    });

    // Wait for query GC (~120ms) — entity is now scheduled for its own gcTime: 2
    await sleep(200);
    expect(client.entityMap.getEntity(entityKey)).toBeDefined();

    // Before entity GC fires, a new query references the same entity
    await testWithClient(client, async () => {
      await fetchQuery(GetCancel2);
      expect(client.entityMap.getEntity(entityKey)).toBeDefined();

      // Wait past the entity's gcTime bucket — entity should survive
      // because re-referencing incremented the ref count back above 0
      await sleep(300);
      expect(client.entityMap.getEntity(entityKey)).toBeDefined();
    });

    // After second query deactivates + both GC cycles, entity should finally go
    await sleep(500);
    expect(client.entityMap.getEntity(entityKey)).toBeUndefined();
  });

  it('should respect entity gcTime when entity type is wrapped (e.g. t.optional)', async () => {
    class WrappedEntity extends Entity {
      static cache = { gcTime: 2 }; // 2 minutes → ~120ms at 0.001

      __typename = t.typename('Wrapped');
      id = t.id;
      value = t.string;
    }

    class GetWrapped extends RESTQuery {
      path = '/wrapped';
      result = { item: t.optional(t.entity(WrappedEntity)) };
      config = { gcTime: 1 };
    }

    mockFetch.get('/wrapped', {
      item: { __typename: 'Wrapped', id: 1, value: 'hello' },
    });

    const entityKey = hashValue(['Wrapped', 1]);

    await testWithClient(client, async () => {
      await fetchQuery(GetWrapped);
      expect(client.entityMap.getEntity(entityKey)).toBeDefined();
    });

    // Query GC fires (~120ms), but entity should survive because its
    // gcTime: 2 is preserved through the t.optional() wrapper.
    await sleep(200);
    expect(client.entityMap.getEntity(entityKey)).toBeDefined();

    // Eventually the entity's own GC bucket fires
    await sleep(300);
    expect(client.entityMap.getEntity(entityKey)).toBeUndefined();
  });

  it('should evict child entities when parent entity children change on refetch', async () => {
    class Tag extends Entity {
      __typename = t.typename('GcTag');
      id = t.id;
      label = t.string;
    }

    class Post extends Entity {
      __typename = t.typename('GcPost');
      id = t.id;
      title = t.string;
      tags = t.array(t.entity(Tag));
    }

    class GetPost extends RESTQuery {
      path = '/gc-post';
      result = { post: t.entity(Post) };
      config = { gcTime: 1 };
    }

    mockFetch.get('/gc-post', {
      post: {
        __typename: 'GcPost',
        id: 1,
        title: 'Post',
        tags: [
          { __typename: 'GcTag', id: 1, label: 'old-tag-1' },
          { __typename: 'GcTag', id: 2, label: 'old-tag-2' },
        ],
      },
    });

    const tag1Key = hashValue(['GcTag', 1]);
    const tag2Key = hashValue(['GcTag', 2]);
    const tag3Key = hashValue(['GcTag', 3]);

    await testWithClient(client, async () => {
      const relay = fetchQuery(GetPost);
      await relay;

      expect(client.entityMap.getEntity(tag1Key)).toBeDefined();
      expect(client.entityMap.getEntity(tag2Key)).toBeDefined();

      // Refetch with different children — tag 2 removed, tag 3 added
      mockFetch.get('/gc-post', {
        post: {
          __typename: 'GcPost',
          id: 1,
          title: 'Post Updated',
          tags: [
            { __typename: 'GcTag', id: 1, label: 'old-tag-1' },
            { __typename: 'GcTag', id: 3, label: 'new-tag-3' },
          ],
        },
      });

      await relay.value!.__refetch();

      // Tag 1 still referenced, tag 3 newly added
      expect(client.entityMap.getEntity(tag1Key)).toBeDefined();
      expect(client.entityMap.getEntity(tag3Key)).toBeDefined();

      // Tag 2 should be evicted — no gcTime on Tag, so immediate removal
      expect(client.entityMap.getEntity(tag2Key)).toBeUndefined();
    });
  });

  it('should handle entities on disk alongside LRU eviction', async () => {
    class User extends Entity {
      __typename = t.typename('LruUser');
      id = t.id;
      name = t.string;
    }

    class GetUser extends RESTQuery {
      static cache = { maxCount: 2, cacheTime: 5000 / 60_000 };
      params = { id: t.id };
      path = `/users/${this.params.id}`;
      result = { user: t.entity(User) };
    }

    mockFetch.get('/users/1', { user: { __typename: 'LruUser', id: 1, name: 'User 1' } });
    mockFetch.get('/users/2', { user: { __typename: 'LruUser', id: 2, name: 'User 2' } });
    mockFetch.get('/users/3', { user: { __typename: 'LruUser', id: 3, name: 'User 3' } });

    await testWithClient(client, async () => {
      await fetchQuery(GetUser, { id: '1' });
      await fetchQuery(GetUser, { id: '2' });
      await fetchQuery(GetUser, { id: '3' });

      const query1Key = queryKeyForClass(GetUser, { id: '1' });
      const query2Key = queryKeyForClass(GetUser, { id: '2' });
      const query3Key = queryKeyForClass(GetUser, { id: '3' });

      // All in memory
      expect(client.queryInstances.has(query1Key)).toBe(true);
      expect(client.queryInstances.has(query2Key)).toBe(true);
      expect(client.queryInstances.has(query3Key)).toBe(true);

      // First query evicted from disk by LRU
      expect(kv.getString(valueKeyFor(query1Key))).toBeUndefined();
      expect(kv.getString(valueKeyFor(query2Key))).toBeDefined();
      expect(kv.getString(valueKeyFor(query3Key))).toBeDefined();
    });
  });
});
