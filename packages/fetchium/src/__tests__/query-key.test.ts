import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryPersistentStore, SyncQueryStore } from '../stores/sync.js';
import { QueryClient } from '../QueryClient.js';
import { t } from '../typeDefs.js';
import { Query, queryKeyForClass } from '../query.js';
import { Mutation, mutationKeyForClass, getMutation } from '../mutation.js';
import { createMockFetch, testWithClient } from './utils.js';

/**
 * Tests for queryKeyForClass and mutationKeyForClass utilities.
 */

describe('queryKeyForClass', () => {
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

  it('should return a stable key for the same class and params', () => {
    class GetUser extends Query {
      readonly path = '/users/[id]';
      readonly response = { name: t.string };
    }

    const key1 = queryKeyForClass(GetUser, { id: '1' });
    const key2 = queryKeyForClass(GetUser, { id: '1' });

    expect(key1).toBe(key2);
    expect(typeof key1).toBe('number');
  });

  it('should return different keys for different params', () => {
    class GetUser extends Query {
      readonly path = '/users/[id]';
      readonly response = { name: t.string };
    }

    const key1 = queryKeyForClass(GetUser, { id: '1' });
    const key2 = queryKeyForClass(GetUser, { id: '2' });

    expect(key1).not.toBe(key2);
  });

  it('should return different keys for different query classes', () => {
    class GetUser extends Query {
      readonly path = '/users/[id]';
      readonly response = { name: t.string };
    }

    class GetPost extends Query {
      readonly path = '/posts/[id]';
      readonly response = { title: t.string };
    }

    const key1 = queryKeyForClass(GetUser, { id: '1' });
    const key2 = queryKeyForClass(GetPost, { id: '1' });

    expect(key1).not.toBe(key2);
  });

  it('should return a consistent key for undefined params', () => {
    class GetItems extends Query {
      readonly path = '/items';
      readonly response = { items: t.array(t.string) };
    }

    const key1 = queryKeyForClass(GetItems, undefined);
    const key2 = queryKeyForClass(GetItems, undefined);

    expect(key1).toBe(key2);
  });
});

describe('mutationKeyForClass', () => {
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

  it('should throw for unregistered mutation class', () => {
    class UnusedMutation extends Mutation {
      readonly path = '/unused';
      readonly method = 'POST' as const;
      readonly request = { name: t.string };
      readonly response = { id: t.number };
    }

    expect(() => mutationKeyForClass(UnusedMutation)).toThrow('Mutation definition not found');
  });

  it('should return a stable ID after the mutation is registered via getMutation', async () => {
    class CreateUser extends Mutation {
      readonly path = '/users';
      readonly method = 'POST' as const;
      readonly request = { name: t.string };
      readonly response = { id: t.number, name: t.string };
    }

    mockFetch.post('/users', { id: 1, name: 'Alice' });

    await testWithClient(client, async () => {
      // Register the mutation by calling getMutation
      getMutation(CreateUser);

      const key1 = mutationKeyForClass(CreateUser);
      const key2 = mutationKeyForClass(CreateUser);

      expect(key1).toBe(key2);
      expect(typeof key1).toBe('string');
      expect(key1).toContain('mutation:POST:/users');
    });
  });

  it('should return different IDs for different mutation classes', async () => {
    class CreateUser extends Mutation {
      readonly path = '/users';
      readonly method = 'POST' as const;
      readonly request = { name: t.string };
      readonly response = { id: t.number };
    }

    class DeleteUser extends Mutation {
      readonly path = '/users/[id]';
      readonly method = 'DELETE' as const;
      readonly request = { id: t.number };
      readonly response = { success: t.boolean };
    }

    mockFetch.post('/users', { id: 1 });
    mockFetch.delete('/users/[id]', { success: true });

    await testWithClient(client, async () => {
      getMutation(CreateUser);
      getMutation(DeleteUser);

      const key1 = mutationKeyForClass(CreateUser);
      const key2 = mutationKeyForClass(DeleteUser);

      expect(key1).not.toBe(key2);
    });
  });
});
