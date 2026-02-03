import { describe, it, expect } from 'vitest';
import { t, entity } from '../../typeDefs.js';
import { query } from '../../query.js';
import { parseEntities } from '../../parseEntities.js';
import { setupParsingTests, testWithClient, getEntityKey, getDocument, getEntityRefs } from './test-utils.js';

/**
 * t.id Tests
 *
 * t.id is used to mark the identifier field within an entity.
 * It accepts both string and number values and is used for entity normalization.
 *
 * Tests cover:
 * - Basic entity usage
 * - Query integration with entities
 * - Entities within arrays, records, and unions
 */

describe('t.id', () => {
  describe('Entity integration', () => {
    const getContext = setupParsingTests();

    describe('basic usage', () => {
      it('should parse string id in entity', async () => {
        const { client, kv } = getContext();

        const User = entity(() => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
        }));

        const QueryResult = t.object({ user: User });

        const result = {
          user: { __typename: 'User', id: 'user-123', name: 'Alice' },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('User', 'user-123', User.shapeKey);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).id).toBe('user-123');
        expect((doc as any).name).toBe('Alice');
      });

      it('should parse number id in entity', async () => {
        const { client, kv } = getContext();

        const User = entity(() => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
        }));

        const QueryResult = t.object({ user: User });

        const result = {
          user: { __typename: 'User', id: 123, name: 'Bob' },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('User', 123, User.shapeKey);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).id).toBe(123);
        expect((doc as any).name).toBe('Bob');
      });

      it('should handle UUID string ids', async () => {
        const { client, kv } = getContext();

        const User = entity(() => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
        }));

        const QueryResult = t.object({ user: User });

        const uuid = '550e8400-e29b-41d4-a716-446655440000';
        const result = {
          user: { __typename: 'User', id: uuid, name: 'Carol' },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('User', uuid, User.shapeKey);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).id).toBe(uuid);
      });
    });

    describe('within array', () => {
      it('should parse array of entities with ids', async () => {
        const { client, kv } = getContext();

        const Item = entity(() => ({
          __typename: t.typename('Item'),
          id: t.id,
          name: t.string,
        }));

        const QueryResult = t.object({ items: t.array(Item) });

        const result = {
          items: [
            { __typename: 'Item', id: 1, name: 'Item1' },
            { __typename: 'Item', id: 'item-2', name: 'Item2' },
            { __typename: 'Item', id: 3, name: 'Item3' },
          ],
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        expect(entityRefs.size).toBe(3);

        expect(await getDocument(kv, getEntityKey('Item', 1, Item.shapeKey))).toBeDefined();
        expect(await getDocument(kv, getEntityKey('Item', 'item-2', Item.shapeKey))).toBeDefined();
        expect(await getDocument(kv, getEntityKey('Item', 3, Item.shapeKey))).toBeDefined();
      });
    });

    describe('within record', () => {
      it('should parse record of entities with ids', async () => {
        const { client, kv } = getContext();

        const User = entity(() => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
        }));

        const QueryResult = t.object({ users: t.record(User) });

        const result = {
          users: {
            alice: { __typename: 'User', id: 'u-1', name: 'Alice' },
            bob: { __typename: 'User', id: 2, name: 'Bob' },
          },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        expect(entityRefs.size).toBe(2);

        expect(await getDocument(kv, getEntityKey('User', 'u-1', User.shapeKey))).toBeDefined();
        expect(await getDocument(kv, getEntityKey('User', 2, User.shapeKey))).toBeDefined();
      });
    });

    describe('within union', () => {
      it('should parse entity union with different id types', async () => {
        const { client, kv } = getContext();

        const Dog = entity(() => ({
          __typename: t.typename('Dog'),
          id: t.id,
          breed: t.string,
        }));

        const Cat = entity(() => ({
          __typename: t.typename('Cat'),
          id: t.id,
          color: t.string,
        }));

        const PetUnion = t.union(Dog, Cat);
        const QueryResult = t.object({ pet: PetUnion });

        const result = {
          pet: { __typename: 'Dog', id: 'dog-1', breed: 'Labrador' },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Dog', 'dog-1', Dog.shapeKey);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).id).toBe('dog-1');
        expect((doc as any).breed).toBe('Labrador');
      });

      it('should parse array of entity unions', async () => {
        const { client, kv } = getContext();

        const Dog = entity(() => ({
          __typename: t.typename('Dog'),
          id: t.id,
          breed: t.string,
        }));

        const Cat = entity(() => ({
          __typename: t.typename('Cat'),
          id: t.id,
          color: t.string,
        }));

        const PetUnion = t.union(Dog, Cat);
        const QueryResult = t.object({ pets: t.array(PetUnion) });

        const result = {
          pets: [
            { __typename: 'Dog', id: 1, breed: 'Lab' },
            { __typename: 'Cat', id: 'cat-1', color: 'Orange' },
          ],
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        expect(entityRefs.size).toBe(2);
        expect(await getDocument(kv, getEntityKey('Dog', 1, Dog.shapeKey))).toBeDefined();
        expect(await getDocument(kv, getEntityKey('Cat', 'cat-1', Cat.shapeKey))).toBeDefined();
      });
    });

    describe('nested entities', () => {
      it('should track refs for nested entities', async () => {
        const { client, kv } = getContext();

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

        const QueryResult = t.object({ user: User });

        const result = {
          user: {
            __typename: 'User',
            id: 'u-1',
            name: 'Alice',
            address: { __typename: 'Address', id: 'addr-100', city: 'NYC' },
          },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const userKey = getEntityKey('User', 'u-1', User.shapeKey);
        const addressKey = getEntityKey('Address', 'addr-100', Address.shapeKey);

        const userRefs = await getEntityRefs(kv, userKey);
        expect(userRefs).toBeDefined();
        expect(userRefs).toContain(addressKey);
      });
    });
  });

  describe('Query integration', () => {
    const getContext = setupParsingTests();

    describe('basic usage', () => {
      it('should parse entity with id in query response', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/user', {
          user: { __typename: 'User', id: 'user-123', name: 'Alice' },
        });

        await testWithClient(client, async () => {
          const User = entity(() => ({
            __typename: t.typename('User'),
            id: t.id,
            name: t.string,
          }));

          const getUser = query(() => ({
            path: '/user',
            response: { user: User },
          }));

          const relay = getUser();
          const result = await relay;

          expect(result.user.id).toBe('user-123');
          expect(result.user.name).toBe('Alice');
        });
      });
    });

    describe('within array', () => {
      it('should parse array of entities in query', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/users', {
          users: [
            { __typename: 'User', id: 1, name: 'Alice' },
            { __typename: 'User', id: 2, name: 'Bob' },
          ],
        });

        await testWithClient(client, async () => {
          const User = entity(() => ({
            __typename: t.typename('User'),
            id: t.id,
            name: t.string,
          }));

          const getUsers = query(() => ({
            path: '/users',
            response: { users: t.array(User) },
          }));

          const relay = getUsers();
          const result = await relay;

          expect(result.users).toHaveLength(2);
          expect(result.users[0].id).toBe(1);
          expect(result.users[1].id).toBe(2);
        });
      });
    });

    describe('within record', () => {
      it('should parse record of entities in query', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/users/map', {
          users: {
            alice: { __typename: 'User', id: 'u-1', name: 'Alice' },
            bob: { __typename: 'User', id: 'u-2', name: 'Bob' },
          },
        });

        await testWithClient(client, async () => {
          const User = entity(() => ({
            __typename: t.typename('User'),
            id: t.id,
            name: t.string,
          }));

          const getUsers = query(() => ({
            path: '/users/map',
            response: { users: t.record(User) },
          }));

          const relay = getUsers();
          const result = await relay;

          expect(result.users.alice.id).toBe('u-1');
          expect(result.users.bob.id).toBe('u-2');
        });
      });
    });
  });
});
