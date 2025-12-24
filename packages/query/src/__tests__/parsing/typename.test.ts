import { describe, it, expect } from 'vitest';
import { t, entity } from '../../typeDefs.js';
import { query } from '../../query.js';
import { parseEntities } from '../../parseEntities.js';
import { setupParsingTests, testWithClient, getEntityKey, getDocument, getEntityRefs } from './test-utils.js';

/**
 * t.typename Tests
 *
 * t.typename is used to define the discriminator for entities.
 * It enables entity normalization by type and works with entity unions.
 *
 * Tests cover:
 * - Basic entity usage
 * - Query integration with entities
 * - Entity unions (discriminated by typename)
 * - Entities within arrays, records, and unions
 */

describe('t.typename', () => {
  describe('Entity integration', () => {
    const getContext = setupParsingTests();

    describe('basic usage', () => {
      it('should parse typename field in entity', async () => {
        const { client, kv } = getContext();

        const User = entity(() => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
        }));

        const QueryResult = t.object({ user: User });

        const result = {
          user: { __typename: 'User', id: 1, name: 'Alice' },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('User', 1);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).__typename).toBe('User');
        expect((doc as any).name).toBe('Alice');
      });

      it('should use correct typename from entity', async () => {
        const { client, kv } = getContext();

        const User = entity(() => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
        }));

        const QueryResult = t.object({ user: User });

        const result = {
          user: { __typename: 'User', id: 1, name: 'Alice' },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('User', 1);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).__typename).toBe('User');
      });
    });

    describe('discriminated entity unions', () => {
      it('should parse Dog entity from union', async () => {
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
          pet: { __typename: 'Dog', id: 1, breed: 'Labrador' },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Dog', 1);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).__typename).toBe('Dog');
        expect((doc as any).breed).toBe('Labrador');
      });

      it('should parse Cat entity from union', async () => {
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
          pet: { __typename: 'Cat', id: 2, color: 'Orange' },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Cat', 2);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).__typename).toBe('Cat');
        expect((doc as any).color).toBe('Orange');
      });

      it('should reject unknown typename in union', () => {
        const { client } = getContext();

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
          pet: { __typename: 'Bird', id: 3, species: 'Parrot' },
        };

        const entityRefs = new Set<number>();

        expect(() => parseEntities(result, QueryResult, client, entityRefs)).toThrow(/Unknown typename 'Bird'/);
      });
    });

    describe('within array', () => {
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
            { __typename: 'Cat', id: 2, color: 'Orange' },
            { __typename: 'Dog', id: 3, breed: 'Poodle' },
          ],
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        expect(entityRefs.size).toBe(3);

        const dog1 = await getDocument(kv, getEntityKey('Dog', 1));
        expect((dog1 as any).__typename).toBe('Dog');

        const cat = await getDocument(kv, getEntityKey('Cat', 2));
        expect((cat as any).__typename).toBe('Cat');

        const dog3 = await getDocument(kv, getEntityKey('Dog', 3));
        expect((dog3 as any).__typename).toBe('Dog');
      });
    });

    describe('within record', () => {
      it('should parse record of entity unions', async () => {
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
        const QueryResult = t.object({ pets: t.record(PetUnion) });

        const result = {
          pets: {
            pet1: { __typename: 'Dog', id: 1, breed: 'Lab' },
            pet2: { __typename: 'Cat', id: 2, color: 'Black' },
          },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        expect(entityRefs.size).toBe(2);

        const dog = await getDocument(kv, getEntityKey('Dog', 1));
        expect((dog as any).__typename).toBe('Dog');

        const cat = await getDocument(kv, getEntityKey('Cat', 2));
        expect((cat as any).__typename).toBe('Cat');
      });
    });

    describe('nested entities with typename', () => {
      it('should track refs for nested entities with different typenames', async () => {
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
            id: 1,
            name: 'Alice',
            address: { __typename: 'Address', id: 100, city: 'NYC' },
          },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const userKey = getEntityKey('User', 1);
        const addressKey = getEntityKey('Address', 100);

        // User should reference Address
        const userRefs = await getEntityRefs(kv, userKey);
        expect(userRefs).toBeDefined();
        expect(userRefs).toContain(addressKey);
      });
    });
  });

  describe('Query integration', () => {
    const getContext = setupParsingTests();

    describe('basic usage', () => {
      it('should parse entity typename in query', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/user', {
          user: { __typename: 'User', id: 1, name: 'Alice' },
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

          expect(result.user.__typename).toBe('User');
          expect(result.user.name).toBe('Alice');
        });
      });
    });

    describe('within union', () => {
      it('should parse discriminated entity union in query', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/pet', {
          pet: { __typename: 'Dog', id: 1, breed: 'Lab' },
        });

        await testWithClient(client, async () => {
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

          const getPet = query(() => ({
            path: '/pet',
            response: { pet: PetUnion },
          }));

          const relay = getPet();
          const result = await relay;

          expect(result.pet.__typename).toBe('Dog');
          expect((result.pet as any).breed).toBe('Lab');
        });
      });

      it('should parse array of entity unions in query', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/pets', {
          pets: [
            { __typename: 'Dog', id: 1, breed: 'Lab' },
            { __typename: 'Cat', id: 2, color: 'Orange' },
          ],
        });

        await testWithClient(client, async () => {
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

          const getPets = query(() => ({
            path: '/pets',
            response: { pets: t.array(PetUnion) },
          }));

          const relay = getPets();
          const result = await relay;

          expect(result.pets).toHaveLength(2);
          expect(result.pets[0].__typename).toBe('Dog');
          expect(result.pets[1].__typename).toBe('Cat');
        });
      });
    });

    describe('within array', () => {
      it('should parse array of typed entities in query', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/items', {
          items: [
            { __typename: 'Item', id: 1, name: 'Item1' },
            { __typename: 'Item', id: 2, name: 'Item2' },
          ],
        });

        await testWithClient(client, async () => {
          const Item = entity(() => ({
            __typename: t.typename('Item'),
            id: t.id,
            name: t.string,
          }));

          const getItems = query(() => ({
            path: '/items',
            response: { items: t.array(Item) },
          }));

          const relay = getItems();
          const result = await relay;

          expect(result.items).toHaveLength(2);
          expect(result.items[0].__typename).toBe('Item');
          expect(result.items[1].__typename).toBe('Item');
        });
      });
    });

    describe('within record', () => {
      it('should parse record of typed entities in query', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/configs', {
          configs: {
            a: { __typename: 'Config', id: 1, value: 'one' },
            b: { __typename: 'Config', id: 2, value: 'two' },
          },
        });

        await testWithClient(client, async () => {
          const Config = entity(() => ({
            __typename: t.typename('Config'),
            id: t.id,
            value: t.string,
          }));

          const getConfigs = query(() => ({
            path: '/configs',
            response: { configs: t.record(Config) },
          }));

          const relay = getConfigs();
          const result = await relay;

          expect(result.configs.a.__typename).toBe('Config');
          expect(result.configs.b.__typename).toBe('Config');
        });
      });
    });
  });
});
