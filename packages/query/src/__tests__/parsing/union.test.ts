import { describe, it, expect } from 'vitest';
import { t, entity } from '../../typeDefs.js';
import { parseValue } from '../../proxy.js';
import { query } from '../../query.js';
import { parseEntities } from '../../parseEntities.js';
import { setupParsingTests, testWithClient, getEntityKey, getDocument, getEntityRefs } from './test-utils.js';

/**
 * t.union Tests
 *
 * Tests for union type parsing across:
 * - Direct parseValue usage
 * - Query integration
 * - Entity integration
 * - Container types (object, array, record, union)
 */

describe('t.union', () => {
  describe('Direct parseValue', () => {
    describe('primitive unions', () => {
      it('should parse string in union', () => {
        const unionType = t.union(t.string, t.number, t.boolean);
        expect(parseValue('hello', unionType, 'test')).toBe('hello');
      });

      it('should parse number in union', () => {
        const unionType = t.union(t.string, t.number, t.boolean);
        expect(parseValue(42, unionType, 'test')).toBe(42);
      });

      it('should parse boolean in union', () => {
        const unionType = t.union(t.string, t.number, t.boolean);
        expect(parseValue(true, unionType, 'test')).toBe(true);
      });

      it('should throw for values not in union', () => {
        const unionType = t.union(t.string, t.number);
        expect(() => parseValue({}, unionType, 'test')).toThrow();
        expect(() => parseValue([], unionType, 'test')).toThrow();
        expect(() => parseValue(null, unionType, 'test')).toThrow();
      });
    });

    describe('nullable unions', () => {
      it('should parse null in nullable union', () => {
        const unionType = t.union(t.string, t.null);
        expect(parseValue(null, unionType, 'test')).toBe(null);
        expect(parseValue('hello', unionType, 'test')).toBe('hello');
      });

      it('should parse undefined in optional union', () => {
        const unionType = t.union(t.string, t.undefined);
        expect(parseValue(undefined, unionType, 'test')).toBe(undefined);
        expect(parseValue('hello', unionType, 'test')).toBe('hello');
      });
    });

    describe('object unions (discriminated)', () => {
      // Note: Discriminated unions by typename typically work through entities
      // or query parsing, not direct parseValue which handles primitive unions.
      // These tests are included for documentation of expected behavior.

      it('should parse union with matching primitive values', () => {
        const unionType = t.union(t.string, t.object({ value: t.number }));

        const stringResult = parseValue('hello', unionType, 'test');
        expect(stringResult).toBe('hello');

        const objResult = parseValue({ value: 42 }, unionType, 'test') as any;
        expect(objResult.value).toBe(42);
      });
    });

    describe('within object', () => {
      it('should parse union fields in objects', () => {
        const unionType = t.union(t.string, t.number);
        const objType = t.object({ value: unionType });

        expect(parseValue({ value: 'hello' }, objType, 'test')).toEqual({ value: 'hello' });
        expect(parseValue({ value: 42 }, objType, 'test')).toEqual({ value: 42 });
      });
    });

    describe('within array', () => {
      it('should parse array of union values', () => {
        const unionType = t.union(t.string, t.number);
        const result = parseValue(['hello', 42, 'world', 123], t.array(unionType), 'test');
        expect(result).toEqual(['hello', 42, 'world', 123]);
      });

      it('should filter invalid items in union array', () => {
        const unionType = t.union(t.string, t.number);
        const result = parseValue(['hello', true, 42], t.array(unionType), 'test', false, () => {});
        expect(result).toEqual(['hello', 42]);
      });
    });

    describe('within record', () => {
      it('should parse record of union values', () => {
        const unionType = t.union(t.string, t.number);
        const result = parseValue({ name: 'test', count: 42 }, t.record(unionType), 'test');
        expect(result).toEqual({ name: 'test', count: 42 });
      });
    });

    describe('nested unions', () => {
      it('should parse nested union types', () => {
        const innerUnion = t.union(t.string, t.number);
        const outerUnion = t.union(innerUnion, t.boolean);

        expect(parseValue('hello', outerUnion, 'test')).toBe('hello');
        expect(parseValue(42, outerUnion, 'test')).toBe(42);
        expect(parseValue(true, outerUnion, 'test')).toBe(true);
      });
    });

    describe('edge cases', () => {
      it('should show union types in error message', () => {
        const unionType = t.union(t.string, t.number);
        expect(() => parseValue({}, unionType, 'GET:/value')).toThrow(
          /Validation error at GET:\/value: expected .*(string.*number|number.*string).*, got object/,
        );
      });

      it('should handle single type in union (identity)', () => {
        const unionType = t.union(t.string);
        expect(parseValue('hello', unionType, 'test')).toBe('hello');
      });
    });
  });

  describe('discriminated union validation', () => {
    describe('entities without __typename', () => {
      const getContext = setupParsingTests();

      it('should throw when entity data is missing __typename', () => {
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

        // Missing __typename
        const result = {
          pet: { id: 1, breed: 'Lab' },
        };

        const entityRefs = new Set<number>();
        expect(() => parseEntities(result, QueryResult, client, entityRefs)).toThrow(
          /required for union discrimination/,
        );
      });

      it('should throw when entity data has unknown __typename', () => {
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

        // Unknown __typename
        const result = {
          pet: { __typename: 'Bird', id: 1, species: 'Parrot' },
        };

        const entityRefs = new Set<number>();
        expect(() => parseEntities(result, QueryResult, client, entityRefs)).toThrow(/Unknown typename 'Bird'/);
      });

      it('should throw for missing typename in nested entity union', () => {
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

        const Owner = entity(() => ({
          __typename: t.typename('Owner'),
          id: t.id,
          pet: PetUnion,
        }));

        const QueryResult = t.object({ owner: Owner });

        const result = {
          owner: {
            __typename: 'Owner',
            id: 1,
            pet: { id: 2, color: 'Orange' }, // Missing __typename
          },
        };

        const entityRefs = new Set<number>();
        expect(() => parseEntities(result, QueryResult, client, entityRefs)).toThrow(
          /required for union discrimination/,
        );
      });
    });

    describe('objects without __typename in parseValue', () => {
      it('should throw when object cannot match any union member', () => {
        const ObjA = t.object({
          __typename: t.typename('ObjA'),
          value: t.string,
        });

        const ObjB = t.object({
          __typename: t.typename('ObjB'),
          count: t.number,
        });

        const unionType = t.union(ObjA, ObjB);

        // Object without __typename won't match any member
        expect(() => parseValue({ value: 'test' }, unionType, 'test')).toThrow();
      });

      it('should throw when object has unknown __typename', () => {
        const ObjA = t.object({
          __typename: t.typename('ObjA'),
          value: t.string,
        });

        const ObjB = t.object({
          __typename: t.typename('ObjB'),
          count: t.number,
        });

        const unionType = t.union(ObjA, ObjB);

        expect(() => parseValue({ __typename: 'ObjC', value: 'test' }, unionType, 'test')).toThrow();
      });
    });
  });

  describe('union type combinations', () => {
    describe('single array in union', () => {
      it('should allow single array type with primitives', () => {
        const unionType = t.union(t.string, t.array(t.number));

        expect(parseValue('hello', unionType, 'test')).toBe('hello');
        expect(parseValue([1, 2, 3], unionType, 'test')).toEqual([1, 2, 3]);
      });

      it('should allow single array type with nullable', () => {
        const unionType = t.union(t.array(t.string), t.null);

        expect(parseValue(['a', 'b'], unionType, 'test')).toEqual(['a', 'b']);
        expect(parseValue(null, unionType, 'test')).toBeNull();
      });
    });

    describe('array of discriminated entities', () => {
      const getContext = setupParsingTests();

      it('should parse array of entity union correctly', async () => {
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

        const dogDoc1 = await getDocument(kv, getEntityKey('Dog', 1));
        expect((dogDoc1 as any).breed).toBe('Lab');

        const catDoc = await getDocument(kv, getEntityKey('Cat', 2));
        expect((catDoc as any).color).toBe('Orange');
      });
    });

    describe('valid primitive + object/entity combinations', () => {
      it('should allow primitives with objects in parseValue', () => {
        // When mixing primitives with objects, parseValue tries each type
        const unionType = t.union(t.string, t.number, t.boolean);

        expect(parseValue('hello', unionType, 'test')).toBe('hello');
        expect(parseValue(42, unionType, 'test')).toBe(42);
        expect(parseValue(true, unionType, 'test')).toBe(true);
      });

      it('should allow null/undefined with entities', () => {
        const Entity = entity(() => ({
          __typename: t.typename('Entity'),
          id: t.id,
          value: t.string,
        }));

        // null/undefined can be combined with entities (nullable union)
        const unionType = t.union(Entity, t.null);

        expect(parseValue(null, unionType, 'test')).toBeNull();
      });

      const getContext2 = setupParsingTests();

      it('should parse nullable entity union in entity context', async () => {
        const { client, kv } = getContext2();

        const Child = entity(() => ({
          __typename: t.typename('Child'),
          id: t.id,
          name: t.string,
        }));

        const Parent = entity(() => ({
          __typename: t.typename('Parent'),
          id: t.id,
          child: t.nullable(Child),
        }));

        const QueryResult = t.object({ parent: Parent });

        const result = {
          parent: { __typename: 'Parent', id: 1, child: null },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const parentDoc = await getDocument(kv, getEntityKey('Parent', 1));
        expect((parentDoc as any).child).toBeNull();
      });
    });

    describe('record unions', () => {
      it('should parse record in primitive union', () => {
        // Records work at parse time as "object" type
        const unionType = t.union(t.string, t.record(t.number));

        expect(parseValue('hello', unionType, 'test')).toBe('hello');
        expect(parseValue({ a: 1, b: 2 }, unionType, 'test')).toEqual({ a: 1, b: 2 });
      });
    });
  });

  describe('Query integration', () => {
    const getContext = setupParsingTests();

    describe('primitive unions', () => {
      it('should parse primitive union in query response', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/values', { value1: 'string', value2: 42, value3: true });

        await testWithClient(client, async () => {
          const UnionType = t.union(t.string, t.number, t.boolean);

          const getValues = query(() => ({
            path: '/values',
            response: {
              value1: UnionType,
              value2: UnionType,
              value3: UnionType,
            },
          }));

          const relay = getValues();
          const result = await relay;

          expect(result.value1).toBe('string');
          expect(result.value2).toBe(42);
          expect(result.value3).toBe(true);
        });
      });
    });

    describe('nullable unions', () => {
      it('should parse nullable union in query', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/item', { value: null });

        await testWithClient(client, async () => {
          const getItem = query(() => ({
            path: '/item',
            response: { value: t.union(t.string, t.null) },
          }));

          const relay = getItem();
          const result = await relay;

          expect(result.value).toBeNull();
        });
      });
    });

    describe('entity unions', () => {
      it('should parse discriminated entity union in query', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/pet', { pet: { __typename: 'Dog', id: 1, breed: 'Lab' } });

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
    });

    describe('within object', () => {
      it('should parse union in nested object', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/data', {
          wrapper: { value: 42 },
        });

        await testWithClient(client, async () => {
          const getData = query(() => ({
            path: '/data',
            response: {
              wrapper: t.object({
                value: t.union(t.string, t.number),
              }),
            },
          }));

          const relay = getData();
          const result = await relay;

          expect(result.wrapper.value).toBe(42);
        });
      });
    });

    describe('within array', () => {
      it('should parse array of union values in query', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/mixed', { values: ['hello', 42, 'world', 123] });

        await testWithClient(client, async () => {
          const getMixed = query(() => ({
            path: '/mixed',
            response: { values: t.array(t.union(t.string, t.number)) },
          }));

          const relay = getMixed();
          const result = await relay;

          expect(result.values).toEqual(['hello', 42, 'world', 123]);
        });
      });
    });

    describe('within record', () => {
      it('should parse record of union values in query', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/config', {
          settings: { name: 'test', count: 42, enabled: true },
        });

        await testWithClient(client, async () => {
          const getConfig = query(() => ({
            path: '/config',
            response: { settings: t.record(t.union(t.string, t.number, t.boolean)) },
          }));

          const relay = getConfig();
          const result = await relay;

          expect(result.settings.name).toBe('test');
          expect(result.settings.count).toBe(42);
          expect(result.settings.enabled).toBe(true);
        });
      });
    });
  });

  describe('Entity integration', () => {
    const getContext = setupParsingTests();

    describe('primitive unions', () => {
      it('should parse union field in entity', async () => {
        const { client, kv } = getContext();

        const Item = entity(() => ({
          __typename: t.typename('Item'),
          id: t.id,
          value: t.union(t.string, t.number),
        }));

        const QueryResult = t.object({ item: Item });

        const result = {
          item: { __typename: 'Item', id: 1, value: 'text' },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Item', 1);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).value).toBe('text');
      });
    });

    describe('entity unions', () => {
      it('should parse discriminated entity union', async () => {
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

      it('should handle array of entity unions', async () => {
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
          ],
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        expect(entityRefs.size).toBe(2);

        const dogDoc = await getDocument(kv, getEntityKey('Dog', 1));
        expect(dogDoc).toBeDefined();
        expect((dogDoc as any).__typename).toBe('Dog');

        const catDoc = await getDocument(kv, getEntityKey('Cat', 2));
        expect(catDoc).toBeDefined();
        expect((catDoc as any).__typename).toBe('Cat');
      });
    });

    describe('within object', () => {
      it('should parse union in nested object within entity', async () => {
        const { client, kv } = getContext();

        const Config = entity(() => ({
          __typename: t.typename('Config'),
          id: t.id,
          settings: t.object({
            value: t.union(t.string, t.number, t.boolean),
          }),
        }));

        const QueryResult = t.object({ config: Config });

        const result = {
          config: {
            __typename: 'Config',
            id: 1,
            settings: { value: 42 },
          },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Config', 1);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).settings.value).toBe(42);
      });
    });

    describe('within array', () => {
      it('should parse union array in entity', async () => {
        const { client, kv } = getContext();

        const Container = entity(() => ({
          __typename: t.typename('Container'),
          id: t.id,
          values: t.array(t.union(t.string, t.number)),
        }));

        const QueryResult = t.object({ container: Container });

        const result = {
          container: {
            __typename: 'Container',
            id: 1,
            values: ['a', 1, 'b', 2],
          },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Container', 1);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).values).toEqual(['a', 1, 'b', 2]);
      });
    });

    describe('within record', () => {
      it('should parse union record in entity', async () => {
        const { client, kv } = getContext();

        const Settings = entity(() => ({
          __typename: t.typename('Settings'),
          id: t.id,
          data: t.record(t.union(t.string, t.number)),
        }));

        const QueryResult = t.object({ settings: Settings });

        const result = {
          settings: {
            __typename: 'Settings',
            id: 1,
            data: { name: 'test', count: 42 },
          },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Settings', 1);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).data).toEqual({ name: 'test', count: 42 });
      });
    });

    describe('nested entity refs', () => {
      it('should track refs for nested entities in union', async () => {
        const { client, kv } = getContext();

        const Child = entity(() => ({
          __typename: t.typename('Child'),
          id: t.id,
          name: t.string,
        }));

        const ParentA = entity(() => ({
          __typename: t.typename('ParentA'),
          id: t.id,
          child: Child,
        }));

        const ParentB = entity(() => ({
          __typename: t.typename('ParentB'),
          id: t.id,
          child: Child,
        }));

        const ParentUnion = t.union(ParentA, ParentB);
        const QueryResult = t.object({ parent: ParentUnion });

        const result = {
          parent: {
            __typename: 'ParentA',
            id: 1,
            child: { __typename: 'Child', id: 10, name: 'Child' },
          },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const parentKey = getEntityKey('ParentA', 1);
        const childKey = getEntityKey('Child', 10);

        const parentRefs = await getEntityRefs(kv, parentKey);
        expect(parentRefs).toBeDefined();
        expect(parentRefs).toContain(childKey);
      });
    });
  });
});
