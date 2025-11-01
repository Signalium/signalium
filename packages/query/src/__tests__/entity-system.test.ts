import { describe, it, expect, beforeEach } from 'vitest';
import { SyncQueryStore, MemoryPersistentStore, refIdsKeyFor, refCountKeyFor } from '../QueryStore.js';
import { QueryClient } from '../QueryClient.js';
import { entity, t } from '../typeDefs.js';
import { query, ExtractType } from '../query.js';
import { parseObjectEntities, parseArrayEntities, parseEntities } from '../parseEntities.js';
import { createMockFetch, getClientEntityMap, getEntityMapSize, testWithClient } from './utils.js';
import { hashValue } from 'signalium/utils';

/**
 * Entity System Tests
 *
 * Tests entity parsing, deduplication, caching, proxy behavior, and reactivity.
 */

describe('Entity System', () => {
  let client: QueryClient;
  let mockFetch: ReturnType<typeof createMockFetch>;
  let kv: any;
  let store: any;

  beforeEach(() => {
    kv = new MemoryPersistentStore();
    store = new SyncQueryStore(kv);
    mockFetch = createMockFetch();
    client = new QueryClient(store, { fetch: mockFetch as any });
  });

  describe('Entity Proxies', () => {
    it('should create reactive entity proxies', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
        email: t.string,
      }));

      mockFetch.get('/users/[id]', {
        user: {
          __typename: 'User',
          id: 1,
          name: 'Alice',
          email: 'alice@example.com',
        },
      });

      await testWithClient(client, async () => {
        const getUser = query(t => ({
          path: '/users/[id]',
          response: { user: User },
        }));

        const relay = getUser({ id: '1' });
        const result = await relay;

        // Verify proxy provides reactive access
        expect(result.user.name).toBe('Alice');
        expect(result.user.email).toBe('alice@example.com');

        // Verify entity is in the entity map
        const entityMap = getClientEntityMap(client);
        const userKey = hashValue('User:1');
        const entityRecord = entityMap.getEntity(userKey);

        expect(entityRecord).toBeDefined();
        expect(entityRecord!.proxy).toBe(result.user);
      });
    });

    it('should cache property access in entity proxies', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      mockFetch.get('/users/[id]', {
        user: { __typename: 'User', id: 1, name: 'Alice' },
      });

      await testWithClient(client, async () => {
        const getUser = query(t => ({
          path: '/users/[id]',
          response: { user: User },
        }));

        const relay = getUser({ id: '1' });
        const result = await relay;

        const user = result.user;

        // Access same property multiple times
        const name1 = user.name;
        const name2 = user.name;
        const name3 = user.name;

        // All should return the same value
        expect(name1).toBe('Alice');
        expect(name2).toBe('Alice');
        expect(name3).toBe('Alice');

        // Verify caching by checking the entity's cache
        const entityMap = getClientEntityMap(client);
        const userKey = hashValue('User:1');
        const entityRecord = entityMap.getEntity(userKey);

        expect(entityRecord!.cache.has('name')).toBe(true);
        expect(entityRecord!.cache.get('name')).toBe('Alice');
      });
    });

    it('should return updated entity data when refetched', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      mockFetch.get('/users/[id]', {
        user: { __typename: 'User', id: 1, name: 'Alice' },
      });

      await testWithClient(client, async () => {
        const getUser = query(t => ({
          path: '/users/[id]',
          response: { user: User },
        }));

        const relay = getUser({ id: '1' });
        const initialResult = await relay;
        expect(initialResult.user.name).toBe('Alice');

        // Set up updated response after initial fetch
        mockFetch.get('/users/[id]', {
          user: { __typename: 'User', id: 1, name: 'Alice Updated' },
        });

        // Refetch to get updated data
        const refetchedResult = await relay.refetch();

        // Refetch should return the new data
        expect(refetchedResult.user.name).toBe('Alice Updated');

        // The relay value should also be updated
        expect(relay.value!.user.name).toBe('Alice Updated');
      });
    });
  });

  describe('Entity Deduplication', () => {
    it('should deduplicate entities within same response', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      mockFetch.get('/users', {
        users: [
          { __typename: 'User', id: 1, name: 'Alice' },
          { __typename: 'User', id: 2, name: 'Bob' },
          { __typename: 'User', id: 1, name: 'Alice' }, // Duplicate
          { __typename: 'User', id: 3, name: 'Charlie' },
          { __typename: 'User', id: 2, name: 'Bob' }, // Another duplicate
        ],
      });

      await testWithClient(client, async () => {
        const getUsers = query(t => ({
          path: '/users',
          response: {
            users: t.array(User),
          },
        }));

        const relay = getUsers();
        const result = await relay;

        // Verify array length
        expect(result.users).toHaveLength(5);

        // Should only have 3 unique entities in array (deduplication works)
        expect(new Set(result.users).size).toBe(3);
      });
    });

    it('should share entities across multiple queries', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      mockFetch.get('/users/[id]', {
        user: { __typename: 'User', id: 1, name: 'Alice' },
      });

      mockFetch.get('/users', {
        users: [
          { __typename: 'User', id: 1, name: 'Alice' },
          { __typename: 'User', id: 2, name: 'Bob' },
        ],
      });

      mockFetch.get('/author', {
        author: { __typename: 'User', id: 1, name: 'Alice' },
      });

      await testWithClient(client, async () => {
        const getUser = query(t => ({
          path: '/users/[id]',
          response: { user: User },
        }));

        const listUsers = query(t => ({
          path: '/users',
          response: { users: t.array(User) },
        }));

        const getAuthor = query(t => ({
          path: '/author',
          response: { author: User },
        }));

        const relay1 = getUser({ id: '1' });
        const result1 = await relay1;

        const relay2 = listUsers();
        const result2 = await relay2;

        const relay3 = getAuthor();
        const result3 = await relay3;

        // All three should reference the same User entity (id: 1)
        expect(result1.user).toBe(result2.users[0]);
        expect(result1.user).toBe(result3.author);
      });
    });
  });

  describe('Nested Entities', () => {
    it('should parse deeply nested entities', async () => {
      const Address = entity(() => ({
        __typename: t.typename('Address'),
        id: t.id,
        city: t.string,
        country: t.string,
      }));

      const Company = entity(() => ({
        __typename: t.typename('Company'),
        id: t.id,
        name: t.string,
        address: Address,
      }));

      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
        company: Company,
      }));

      mockFetch.get('/users/[id]', {
        user: {
          __typename: 'User',
          id: 1,
          name: 'Alice',
          company: {
            __typename: 'Company',
            id: 1,
            name: 'Tech Corp',
            address: {
              __typename: 'Address',
              id: 1,
              city: 'San Francisco',
              country: 'USA',
            },
          },
        },
      });

      await testWithClient(client, async () => {
        const getUser = query(t => ({
          path: '/users/[id]',
          response: { user: User },
        }));

        const relay = getUser({ id: '1' });
        const result = await relay;

        // Access deeply nested property
        expect(result.user.company.address.city).toBe('San Francisco');

        // All three entities should be in the map
        expect(getEntityMapSize(client)).toBe(3);
      });
    });

    it('should handle entities with multiple nested arrays', async () => {
      const Post = entity(() => ({
        __typename: t.typename('Post'),
        id: t.id,
        title: t.string,
      }));

      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
        posts: t.array(Post),
      }));

      mockFetch.get('/users/[id]', {
        user: {
          __typename: 'User',
          id: 1,
          name: 'Alice',
          posts: [
            {
              __typename: 'Post',
              id: 1,
              title: 'First Post',
            },
            {
              __typename: 'Post',
              id: 2,
              title: 'Second Post',
            },
          ],
        },
      });

      await testWithClient(client, async () => {
        const getUser = query(t => ({
          path: '/users/[id]',
          response: { user: User },
        }));

        const relay = getUser({ id: '1' });
        const result = await relay;

        // Verify user entity
        expect(result.user.name).toBe('Alice');

        // Verify posts array
        expect(result.user.posts).toHaveLength(2);
        expect(result.user.posts[0].title).toBe('First Post');
        expect(result.user.posts[1].title).toBe('Second Post');
      });
    });
  });

  describe('Entity Parsing Functions', () => {
    it('should parse object entities correctly', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      const entityRefs = new Set<number>();
      const data = {
        __typename: 'User',
        id: 1,
        name: 'Test',
      };

      const result = await parseObjectEntities(data, User, client, entityRefs);

      // Should return proxy
      expect(getEntityMapSize(client)).toBe(1);
      expect(entityRefs.size).toBe(1);

      // Result should be a proxy
      const userKey = hashValue('User:1');
      expect(entityRefs.has(userKey)).toBe(true);
    });

    it('should parse array entities correctly', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      const entityRefs = new Set<number>();
      const data = [
        { __typename: 'User', id: 1, name: 'Alice' },
        { __typename: 'User', id: 2, name: 'Bob' },
      ];

      const result = await parseArrayEntities(data, User, client, entityRefs);

      // Should have parsed 2 entities
      expect(getEntityMapSize(client)).toBe(2);
      expect(entityRefs.size).toBe(2);
    });

    it('should parse nested structures with mixed entities', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      const shape = t.object({
        users: t.array(User),
        admin: User,
      });

      const entityRefs = new Set<number>();
      const data = {
        users: [
          { __typename: 'User', id: 1, name: 'Alice' },
          { __typename: 'User', id: 2, name: 'Bob' },
        ],
        admin: { __typename: 'User', id: 1, name: 'Alice' },
      };

      const result = await parseEntities(data, shape, client, entityRefs);

      // Should deduplicate the admin (same as users[0])
      expect(getEntityMapSize(client)).toBe(2);
    });

    it('should handle entities in records/dictionaries', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      mockFetch.get('/users/map', {
        userMap: {
          alice: { __typename: 'User', id: 1, name: 'Alice' },
          bob: { __typename: 'User', id: 2, name: 'Bob' },
        },
      });

      await testWithClient(client, async () => {
        const getUserMap = query(t => ({
          path: '/users/map',
          response: {
            userMap: t.record(User),
          },
        }));

        const relay = getUserMap();
        const result = await relay;

        expect(result.userMap.alice.name).toBe('Alice');
        expect(result.userMap.bob.name).toBe('Bob');

        expect(getEntityMapSize(client)).toBe(2);
      });
    });

    it('should handle union types with entities', async () => {
      type TextPost = ExtractType<typeof TextPost>;
      const TextPost = entity(() => ({
        __typename: t.typename('TextPost'),
        id: t.id,
        content: t.string,
      }));

      type ImagePost = ExtractType<typeof ImagePost>;
      const ImagePost = entity(() => ({
        __typename: t.typename('ImagePost'),
        id: t.id,
        url: t.string,
      }));

      const PostUnion = t.union(TextPost, ImagePost);

      mockFetch.get('/posts', {
        posts: [
          { __typename: 'TextPost', type: 'text', id: '1', content: 'Hello' },
          { __typename: 'ImagePost', type: 'image', id: '2', url: '/img.jpg' },
          { __typename: 'TextPost', type: 'text', id: '3', content: 'World' },
        ],
      });

      await testWithClient(client, async () => {
        const getPosts = query(t => ({
          path: '/posts',
          response: {
            posts: t.array(PostUnion),
          },
        }));

        const relay = getPosts();
        const result = await relay;

        expect(result.posts).toHaveLength(3);

        const post1 = result.posts[0] as TextPost;
        const post2 = result.posts[1] as ImagePost;

        expect(post1.__typename).toBe('TextPost');
        expect(post1.content).toBe('Hello');

        expect(post2.__typename).toBe('ImagePost');
        expect(post2.url).toBe('/img.jpg');

        expect(getEntityMapSize(client)).toBe(3);
      });
    });
  });

  describe('Entity Map Management', () => {
    it('should maintain entity map across queries', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      mockFetch.get('/users', {
        users: [
          { __typename: 'User', id: 1, name: 'Alice' },
          { __typename: 'User', id: 2, name: 'Bob' },
        ],
      });

      await testWithClient(client, async () => {
        const listUsers = query(t => ({
          path: '/users',
          response: { users: t.array(User) },
        }));

        // First query
        const relay = listUsers();
        await relay;

        expect(getEntityMapSize(client)).toBe(2);

        mockFetch.get('/users', {
          users: [
            { __typename: 'User', id: 3, name: 'Charlie' },
            { __typename: 'User', id: 4, name: 'David' },
          ],
        });

        const result = await relay.refetch();

        // The entity map should now have 4 entities
        expect(getEntityMapSize(client)).toBe(4);
      });
    });
  });
});
