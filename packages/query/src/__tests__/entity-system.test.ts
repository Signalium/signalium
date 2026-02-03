import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SyncQueryStore, MemoryPersistentStore } from '../stores/sync.js';
import { QueryClient } from '../QueryClient.js';
import { entity, t } from '../typeDefs.js';
import { query } from '../query.js';
import type { ExtractType } from '../types.js';
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

  afterEach(() => {
    client?.destroy();
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
        const getUser = query(() => ({
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
        const userKey = hashValue(['User:1', User.shapeKey]);
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
        const getUser = query(() => ({
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
        const userKey = hashValue(['User:1', User.shapeKey]);
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
        const getUser = query(() => ({
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
        const getUsers = query(() => ({
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
        const getUser = query(() => ({
          path: '/users/[id]',
          response: { user: User },
        }));

        const listUsers = query(() => ({
          path: '/users',
          response: { users: t.array(User) },
        }));

        const getAuthor = query(() => ({
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
        const getUser = query(() => ({
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
        const getUser = query(() => ({
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
      const userKey = hashValue(['User:1', User.shapeKey]);
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
        const getUserMap = query(() => ({
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
        const getPosts = query(() => ({
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
        const listUsers = query(() => ({
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

  describe('Deep Merge on Entity Updates', () => {
    it('should deep merge nested objects when entity is updated', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
        profile: t.object({
          bio: t.string,
          website: t.string,
        }),
        settings: t.object({
          theme: t.string,
          notifications: t.boolean,
        }),
      }));

      // Initial fetch with complete data
      mockFetch.get('/users/[id]', {
        user: {
          __typename: 'User',
          id: 1,
          name: 'Alice',
          profile: {
            bio: 'Software Engineer',
            website: 'https://alice.dev',
          },
          settings: {
            theme: 'dark',
            notifications: true,
          },
        },
      });

      await testWithClient(client, async () => {
        const getUser = query(() => ({
          path: '/users/[id]',
          response: { user: User },
        }));

        const relay1 = getUser({ id: '1' });
        const result1 = await relay1;

        // Verify initial data
        expect(result1.user.name).toBe('Alice');
        expect(result1.user.profile.bio).toBe('Software Engineer');
        expect(result1.user.profile.website).toBe('https://alice.dev');
        expect(result1.user.settings.theme).toBe('dark');
        expect(result1.user.settings.notifications).toBe(true);

        // Refetch with updated nested data
        mockFetch.get('/users/[id]', {
          user: {
            __typename: 'User',
            id: 1,
            name: 'Alice Smith', // Updated name
            profile: {
              bio: 'Senior Software Engineer', // Updated bio
              website: 'https://alice.dev', // Same website
            },
            settings: {
              theme: 'light', // Updated theme
              notifications: true, // Same notifications
            },
          },
        });

        const result2 = await relay1.refetch();

        // Should have deep merged - all fields should be present with updated values
        expect(result2.user.name).toBe('Alice Smith');
        expect(result2.user.profile.bio).toBe('Senior Software Engineer');
        expect(result2.user.profile.website).toBe('https://alice.dev');
        expect(result2.user.settings.theme).toBe('light');
        expect(result2.user.settings.notifications).toBe(true);

        // Both results should reference the same entity proxy
        expect(result1.user).toBe(result2.user);

        // The first result should also reflect the updates (reactivity)
        expect(result1.user.name).toBe('Alice Smith');
        expect(result1.user.profile.bio).toBe('Senior Software Engineer');
      });
    });

    it('should replace arrays, not merge them', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
        tags: t.array(t.string),
      }));

      // Initial fetch
      mockFetch.get('/users/[id]', {
        user: {
          __typename: 'User',
          id: 1,
          name: 'Alice',
          tags: ['engineer', 'javascript'],
        },
      });

      await testWithClient(client, async () => {
        const getUser = query(() => ({
          path: '/users/[id]',
          response: { user: User },
        }));

        const relay1 = getUser({ id: '1' });
        const result1 = await relay1;

        expect(result1.user.tags).toEqual(['engineer', 'javascript']);

        // Refetch with different array
        mockFetch.get('/users/[id]', {
          user: {
            __typename: 'User',
            id: 1,
            name: 'Alice',
            tags: ['engineer', 'typescript', 'react'], // Different array
          },
        });

        const result2 = await relay1.refetch();

        // Array should be replaced, not merged
        expect(result2.user.tags).toEqual(['engineer', 'typescript', 'react']);
        expect(result2.user.tags.length).toBe(3);

        // Should be the same entity
        expect(result1.user).toBe(result2.user);
      });
    });

    it('should handle multiple levels of nesting', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
        address: t.object({
          street: t.string,
          city: t.string,
          coordinates: t.object({
            lat: t.number,
            lng: t.number,
          }),
        }),
      }));

      // Initial fetch
      mockFetch.get('/users/[id]', {
        user: {
          __typename: 'User',
          id: 1,
          name: 'Alice',
          address: {
            street: '123 Main St',
            city: 'Springfield',
            coordinates: {
              lat: 40.7128,
              lng: -74.006,
            },
          },
        },
      });

      await testWithClient(client, async () => {
        const getUser = query(() => ({
          path: '/users/[id]',
          response: { user: User },
        }));

        const relay1 = getUser({ id: '1' });
        const result1 = await relay1;

        expect(result1.user.address.street).toBe('123 Main St');
        expect(result1.user.address.city).toBe('Springfield');
        expect(result1.user.address.coordinates.lat).toBe(40.7128);
        expect(result1.user.address.coordinates.lng).toBe(-74.006);

        // Refetch with partial nested update
        mockFetch.get('/users/[id]', {
          user: {
            __typename: 'User',
            id: 1,
            name: 'Alice',
            address: {
              street: '456 Oak Ave', // Updated
              city: 'Springfield', // Same
              coordinates: {
                lat: 40.7129, // Updated
                lng: -74.006, // Same
              },
            },
          },
        });

        const result2 = await relay1.refetch();

        // All levels should be deep merged
        expect(result2.user.address.street).toBe('456 Oak Ave');
        expect(result2.user.address.city).toBe('Springfield');
        expect(result2.user.address.coordinates.lat).toBe(40.7129);
        expect(result2.user.address.coordinates.lng).toBe(-74.006);

        // Same entity reference
        expect(result1.user).toBe(result2.user);
      });
    });

    it('should preserve unchanged nested fields when updating', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
        metadata: t.object({
          createdAt: t.string,
          updatedAt: t.string,
          version: t.number,
        }),
      }));

      // Initial fetch
      mockFetch.get('/users/[id]', {
        user: {
          __typename: 'User',
          id: 1,
          name: 'Alice',
          metadata: {
            createdAt: '2024-01-01',
            updatedAt: '2024-01-01',
            version: 1,
          },
        },
      });

      await testWithClient(client, async () => {
        const getUser = query(() => ({
          path: '/users/[id]',
          response: { user: User },
        }));

        const relay1 = getUser({ id: '1' });
        const result1 = await relay1;

        expect(result1.user.metadata.createdAt).toBe('2024-01-01');
        expect(result1.user.metadata.updatedAt).toBe('2024-01-01');
        expect(result1.user.metadata.version).toBe(1);

        // Refetch with partial metadata update
        mockFetch.get('/users/[id]', {
          user: {
            __typename: 'User',
            id: 1,
            name: 'Alice Smith',
            metadata: {
              createdAt: '2024-01-01', // Same
              updatedAt: '2024-01-15', // Updated
              version: 2, // Updated
            },
          },
        });

        const result2 = await relay1.refetch();

        // createdAt should be preserved, others updated
        expect(result2.user.name).toBe('Alice Smith');
        expect(result2.user.metadata.createdAt).toBe('2024-01-01');
        expect(result2.user.metadata.updatedAt).toBe('2024-01-15');
        expect(result2.user.metadata.version).toBe(2);

        // Same entity
        expect(result1.user).toBe(result2.user);
      });
    });

    it('should handle merging from multiple query sources', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
        email: t.string,
        bio: t.string,
      }));

      // First query returns basic user info
      mockFetch.get('/users/[id]/basic', {
        user: {
          __typename: 'User',
          id: 1,
          name: 'Alice',
          email: 'alice@example.com',
          bio: 'Engineer',
        },
      });

      // Second query returns updated info for same user
      mockFetch.get('/users/[id]/profile', {
        user: {
          __typename: 'User',
          id: 1,
          name: 'Alice Smith',
          email: 'alice@example.com',
          bio: 'Senior Software Engineer',
        },
      });

      await testWithClient(client, async () => {
        const getUserBasic = query(() => ({
          path: '/users/[id]/basic',
          response: { user: User },
        }));

        const getUserProfile = query(() => ({
          path: '/users/[id]/profile',
          response: { user: User },
        }));

        // Fetch basic info first
        const relay1 = getUserBasic({ id: '1' });
        const result1 = await relay1;

        expect(result1.user.name).toBe('Alice');
        expect(result1.user.email).toBe('alice@example.com');
        expect(result1.user.bio).toBe('Engineer');

        // Fetch profile info - should merge with existing entity
        const relay2 = getUserProfile({ id: '1' });
        const result2 = await relay2;

        // Both results should have the merged data
        expect(result2.user.name).toBe('Alice Smith');
        expect(result2.user.email).toBe('alice@example.com');
        expect(result2.user.bio).toBe('Senior Software Engineer');

        // First query result should also reflect the merge (same entity)
        expect(result1.user).toBe(result2.user);
        expect(result1.user.name).toBe('Alice Smith');
        expect(result1.user.bio).toBe('Senior Software Engineer');
      });
    });
  });

  describe('Optional Typename in Data', () => {
    it('should return typename from definition when data omits typename field', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      // Data without __typename field
      mockFetch.get('/users/[id]', {
        user: { id: 1, name: 'Alice' },
      });

      await testWithClient(client, async () => {
        const getUser = query(() => ({
          path: '/users/[id]',
          response: { user: User },
        }));

        const relay = getUser({ id: '1' });
        const result = await relay;

        // Typename should be returned from definition even though data omits it
        expect(result.user.__typename).toBe('User');
        expect(result.user.name).toBe('Alice');
        expect(result.user.id).toBe(1);
      });
    });

    it('should work with nested entities without typename in data', async () => {
      const Address = entity(() => ({
        __typename: t.typename('Address'),
        id: t.id,
        city: t.string,
      }));

      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
        address: Address,
      }));

      // Data without __typename fields
      mockFetch.get('/users/[id]', {
        user: {
          id: 1,
          name: 'Alice',
          address: {
            id: 1,
            city: 'San Francisco',
          },
        },
      });

      await testWithClient(client, async () => {
        const getUser = query(() => ({
          path: '/users/[id]',
          response: { user: User },
        }));

        const relay = getUser({ id: '1' });
        const result = await relay;

        expect(result.user.__typename).toBe('User');
        expect(result.user.name).toBe('Alice');
        expect(result.user.address.__typename).toBe('Address');
        expect(result.user.address.city).toBe('San Francisco');
      });
    });

    it('should still accept typename in data when it matches definition', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      // Data with matching __typename field
      mockFetch.get('/users/[id]', {
        user: { __typename: 'User', id: 1, name: 'Alice' },
      });

      await testWithClient(client, async () => {
        const getUser = query(() => ({
          path: '/users/[id]',
          response: { user: User },
        }));

        const relay = getUser({ id: '1' });
        const result = await relay;

        expect(result.user.__typename).toBe('User');
        expect(result.user.name).toBe('Alice');
      });
    });

    it('should filter out union items that omit typename in arrays', async () => {
      const TextPost = entity(() => ({
        __typename: t.typename('TextPost'),
        id: t.id,
        content: t.string,
      }));

      const ImagePost = entity(() => ({
        __typename: t.typename('ImagePost'),
        id: t.id,
        url: t.string,
      }));

      const PostUnion = t.union(TextPost, ImagePost);

      // Data without __typename - should be filtered out in arrays (resilient parsing)
      mockFetch.get('/posts', {
        posts: [{ id: '1', content: 'Hello' }],
      });

      await testWithClient(client, async () => {
        const getPosts = query(() => ({
          path: '/posts',
          response: {
            posts: t.array(PostUnion),
          },
        }));

        const relay = getPosts();
        const result = await relay;

        // Item without typename should be filtered out, resulting in empty array
        expect(result.posts).toEqual([]);
      });
    });

    it('should work with arrays of entities without typename in data', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      // Array data without __typename fields
      mockFetch.get('/users', {
        users: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ],
      });

      await testWithClient(client, async () => {
        const getUsers = query(() => ({
          path: '/users',
          response: { users: t.array(User) },
        }));

        const relay = getUsers();
        const result = await relay;

        expect(result.users).toHaveLength(2);
        expect(result.users[0].__typename).toBe('User');
        expect(result.users[0].name).toBe('Alice');
        expect(result.users[1].__typename).toBe('User');
        expect(result.users[1].name).toBe('Bob');
      });
    });
  });
});
