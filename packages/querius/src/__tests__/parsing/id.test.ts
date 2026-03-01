import { describe, it, expect } from 'vitest';
import { t } from '../../typeDefs.js';
import { Entity } from '../../proxy.js';
import { Query, getQuery } from '../../query.js';
import { parseEntities } from '../../parseEntities.js';
import { setupParsingTests, testWithClient, getEntityKey, getDocument, getEntityRefs, getShapeKey } from './test-utils.js';

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

        class User extends Entity {
          __typename = t.typename('User');
          id = t.id;
          name = t.string;
        }

        const QueryResult = t.object({ user: t.entity(User) });

        const result = {
          user: { __typename: 'User', id: 'user-123', name: 'Alice' },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('User', 'user-123', getShapeKey(t.entity(User)));
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).id).toBe('user-123');
        expect((doc as any).name).toBe('Alice');
      });

      it('should parse number id in entity', async () => {
        const { client, kv } = getContext();

        class User extends Entity {
          __typename = t.typename('User');
          id = t.id;
          name = t.string;
        }

        const QueryResult = t.object({ user: t.entity(User) });

        const result = {
          user: { __typename: 'User', id: 123, name: 'Bob' },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('User', 123, getShapeKey(t.entity(User)));
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).id).toBe(123);
        expect((doc as any).name).toBe('Bob');
      });

      it('should handle UUID string ids', async () => {
        const { client, kv } = getContext();

        class User extends Entity {
          __typename = t.typename('User');
          id = t.id;
          name = t.string;
        }

        const QueryResult = t.object({ user: t.entity(User) });

        const uuid = '550e8400-e29b-41d4-a716-446655440000';
        const result = {
          user: { __typename: 'User', id: uuid, name: 'Carol' },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('User', uuid, getShapeKey(t.entity(User)));
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).id).toBe(uuid);
      });
    });

    describe('within array', () => {
      it('should parse array of entities with ids', async () => {
        const { client, kv } = getContext();

        class Item extends Entity {
          __typename = t.typename('Item');
          id = t.id;
          name = t.string;
        }

        const QueryResult = t.object({ items: t.array(t.entity(Item)) });

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

        expect(await getDocument(kv, getEntityKey('Item', 1, getShapeKey(t.entity(Item))))).toBeDefined();
        expect(await getDocument(kv, getEntityKey('Item', 'item-2', getShapeKey(t.entity(Item))))).toBeDefined();
        expect(await getDocument(kv, getEntityKey('Item', 3, getShapeKey(t.entity(Item))))).toBeDefined();
      });
    });

    describe('within record', () => {
      it('should parse record of entities with ids', async () => {
        const { client, kv } = getContext();

        class User extends Entity {
          __typename = t.typename('User');
          id = t.id;
          name = t.string;
        }

        const QueryResult = t.object({ users: t.record(t.entity(User)) });

        const result = {
          users: {
            alice: { __typename: 'User', id: 'u-1', name: 'Alice' },
            bob: { __typename: 'User', id: 2, name: 'Bob' },
          },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        expect(entityRefs.size).toBe(2);

        expect(await getDocument(kv, getEntityKey('User', 'u-1', getShapeKey(t.entity(User))))).toBeDefined();
        expect(await getDocument(kv, getEntityKey('User', 2, getShapeKey(t.entity(User))))).toBeDefined();
      });
    });

    describe('within union', () => {
      it('should parse entity union with different id types', async () => {
        const { client, kv } = getContext();

        class Dog extends Entity {
          __typename = t.typename('Dog');
          id = t.id;
          breed = t.string;
        }

        class Cat extends Entity {
          __typename = t.typename('Cat');
          id = t.id;
          color = t.string;
        }

        const PetUnion = t.union(t.entity(Dog), t.entity(Cat));
        const QueryResult = t.object({ pet: PetUnion });

        const result = {
          pet: { __typename: 'Dog', id: 'dog-1', breed: 'Labrador' },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Dog', 'dog-1', getShapeKey(t.entity(Dog)));
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).id).toBe('dog-1');
        expect((doc as any).breed).toBe('Labrador');
      });

      it('should parse array of entity unions', async () => {
        const { client, kv } = getContext();

        class Dog extends Entity {
          __typename = t.typename('Dog');
          id = t.id;
          breed = t.string;
        }

        class Cat extends Entity {
          __typename = t.typename('Cat');
          id = t.id;
          color = t.string;
        }

        const PetUnion = t.union(t.entity(Dog), t.entity(Cat));
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
        expect(await getDocument(kv, getEntityKey('Dog', 1, getShapeKey(t.entity(Dog))))).toBeDefined();
        expect(await getDocument(kv, getEntityKey('Cat', 'cat-1', getShapeKey(t.entity(Cat))))).toBeDefined();
      });
    });

    describe('nested entities', () => {
      it('should track refs for nested entities', async () => {
        const { client, kv } = getContext();

        class Address extends Entity {
          __typename = t.typename('Address');
          id = t.id;
          city = t.string;
        }

        class User extends Entity {
          __typename = t.typename('User');
          id = t.id;
          name = t.string;
          address = t.entity(Address);
        }

        const QueryResult = t.object({ user: t.entity(User) });

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

        const userKey = getEntityKey('User', 'u-1', getShapeKey(t.entity(User)));
        const addressKey = getEntityKey('Address', 'addr-100', getShapeKey(t.entity(Address)));

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
          class User extends Entity {
            __typename = t.typename('User');
            id = t.id;
            name = t.string;
          }

          class GetUser extends Query {
            path = '/user';
            response = { user: t.entity(User) };
          }

          const relay = getQuery(GetUser);
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
          class User extends Entity {
            __typename = t.typename('User');
            id = t.id;
            name = t.string;
          }

          class GetUsers extends Query {
            path = '/users';
            response = { users: t.array(t.entity(User)) };
          }

          const relay = getQuery(GetUsers);
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
          class User extends Entity {
            __typename = t.typename('User');
            id = t.id;
            name = t.string;
          }

          class GetUsers extends Query {
            path = '/users/map';
            response = { users: t.record(t.entity(User)) };
          }

          const relay = getQuery(GetUsers);
          const result = await relay;

          expect(result.users.alice.id).toBe('u-1');
          expect(result.users.bob.id).toBe('u-2');
        });
      });
    });
  });
});
