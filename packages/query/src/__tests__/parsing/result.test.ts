import { describe, it, expect } from 'vitest';
import { t, entity } from '../../typeDefs.js';
import { parseValue } from '../../proxy.js';
import { query } from '../../query.js';
import { parseEntities } from '../../parseEntities.js';
import { ParseError, ParseResult, ParseSuccess } from '../../types.js';
import { setupParsingTests, testWithClient, getEntityKey, getDocument } from './test-utils.js';

/**
 * t.result Tests
 *
 * Tests for type-safe parse result wrapping across:
 * - Direct parseValue usage
 * - Query integration
 * - Entity integration
 * - Container types (object, array, record, union)
 *
 * t.result wraps parsing to return:
 * - { success: true, value } on successful parse
 * - { success: false, error } on parse failure
 */

describe('t.result', () => {
  describe('Direct parseValue', () => {
    describe('basic parsing', () => {
      it('should return success for valid value', () => {
        const numberResult = t.result(t.number);
        const result = parseValue(42, numberResult, 'test') as ParseResult<number>;

        expect(result.success).toBe(true);
        expect((result as ParseSuccess<number>).value).toBe(42);
      });

      it('should return failure for invalid value', () => {
        const numberResult = t.result(t.number);
        const result = parseValue('not a number', numberResult, 'test') as ParseResult<number>;

        expect(result.success).toBe(false);
        expect((result as ParseError).error).toBeInstanceOf(Error);
      });

      it('should work with string type', () => {
        const stringResult = t.result(t.string);

        const success = parseValue('hello', stringResult, 'test') as ParseResult<string>;
        expect(success).toEqual({ success: true, value: 'hello' });

        const failure = parseValue(42, stringResult, 'test') as ParseResult<string>;
        expect(failure.success).toBe(false);
      });

      it('should work with boolean type', () => {
        const boolResult = t.result(t.boolean);

        const success = parseValue(true, boolResult, 'test') as ParseResult<boolean>;
        expect(success).toEqual({ success: true, value: true });

        const failure = parseValue('true', boolResult, 'test') as ParseResult<boolean>;
        expect(failure.success).toBe(false);
      });
    });

    describe('with enums', () => {
      it('should return success for valid enum value', () => {
        const Status = t.enum('active', 'inactive', 'pending');
        const statusResult = t.result(Status);

        const result = parseValue('active', statusResult, 'test') as ParseResult<string>;
        expect(result).toEqual({ success: true, value: 'active' });
      });

      it('should return failure for invalid enum value', () => {
        const Status = t.enum('active', 'inactive', 'pending');
        const statusResult = t.result(Status);

        const result = parseValue('unknown', statusResult, 'test') as ParseResult<string>;
        expect(result.success).toBe(false);
        expect((result as ParseError).error).toBeInstanceOf(Error);
      });
    });

    describe('with formatted types', () => {
      it('should return success for valid date format', () => {
        const dateResult = t.result(t.format('date-time'));
        const result = parseValue('2024-01-15T10:30:00.000Z', dateResult, 'test') as ParseResult<Date>;

        expect(result.success).toBe(true);
        expect((result as ParseSuccess<Date>).value).toBeInstanceOf(Date);
      });

      it('should return failure for invalid date format', () => {
        const dateResult = t.result(t.format('date-time'));
        const result = parseValue('not-a-date', dateResult, 'test') as ParseResult<Date>;

        expect(result.success).toBe(false);
        expect((result as ParseError).error).toBeInstanceOf(Error);
      });
    });

    describe('within object', () => {
      it('should handle result inside object', () => {
        const objType = t.object({
          name: t.string,
          maybeNumber: t.result(t.number),
        });

        const result = parseValue({ name: 'Test', maybeNumber: 'not number' }, objType, 'test') as any;

        expect(result.name).toBe('Test');
        expect(result.maybeNumber.success).toBe(false);
      });

      it('should handle nested object inside result', () => {
        const resultType = t.result(t.object({ inner: t.object({ value: t.string }) }));

        const success = parseValue({ inner: { value: 'hello' } }, resultType, 'test') as ParseResult<any>;
        expect(success.success).toBe(true);
        expect((success as ParseSuccess<any>).value.inner.value).toBe('hello');

        const failure = parseValue({ inner: { value: 42 } }, resultType, 'test') as ParseResult<any>;
        expect(failure.success).toBe(false);
      });
    });

    describe('within array', () => {
      it('should wrap each item individually', () => {
        const arrayType = t.array(t.result(t.number));
        const result = parseValue([1, 'not number', 3, null, 5], arrayType, 'test') as Array<ParseResult<number>>;

        expect(result).toHaveLength(5);
        expect(result[0]).toEqual({ success: true, value: 1 });
        expect(result[1].success).toBe(false);
        expect(result[2]).toEqual({ success: true, value: 3 });
        expect(result[3].success).toBe(false);
        expect(result[4]).toEqual({ success: true, value: 5 });
      });

      it('should work with enum arrays', () => {
        const Status = t.enum('active', 'inactive');
        const arrayType = t.array(t.result(Status));

        const result = parseValue(['active', 'unknown', 'inactive'], arrayType, 'test') as Array<ParseResult<string>>;

        expect(result).toHaveLength(3);
        expect(result[0]).toEqual({ success: true, value: 'active' });
        expect(result[1].success).toBe(false);
        expect(result[2]).toEqual({ success: true, value: 'inactive' });
      });
    });

    describe('within record', () => {
      it('should wrap each record value', () => {
        const recordType = t.record(t.result(t.number));
        const result = parseValue({ a: 1, b: 'invalid', c: 3 }, recordType, 'test') as Record<
          string,
          ParseResult<number>
        >;

        expect(result.a).toEqual({ success: true, value: 1 });
        expect(result.b.success).toBe(false);
        expect(result.c).toEqual({ success: true, value: 3 });
      });
    });

    describe('within union', () => {
      it('should work with result wrapped union types', () => {
        const unionResult = t.result(t.union(t.string, t.number));

        expect(parseValue('hello', unionResult, 'test')).toEqual({ success: true, value: 'hello' });
        expect(parseValue(42, unionResult, 'test')).toEqual({ success: true, value: 42 });

        const failure = parseValue(true, unionResult, 'test') as ParseResult<any>;
        expect(failure.success).toBe(false);
      });
    });

    describe('with optional/nullable', () => {
      it('should return error for invalid value with optional wrapper', () => {
        const optionalResult = t.result(t.optional(t.number));

        // undefined IS valid for optional - should succeed
        const undefinedResult = parseValue(undefined, optionalResult, 'test') as ParseResult<number | undefined>;
        expect(undefinedResult.success).toBe(true);
        expect((undefinedResult as ParseSuccess<number | undefined>).value).toBeUndefined();

        // Invalid value should return error, not undefined fallback
        const invalidResult = parseValue('not number', optionalResult, 'test') as ParseResult<number | undefined>;
        expect(invalidResult.success).toBe(false);
      });

      it('should return error for invalid value with nullable wrapper', () => {
        const nullableResult = t.result(t.nullable(t.number));

        // null IS valid for nullable - should succeed
        const nullResult = parseValue(null, nullableResult, 'test') as ParseResult<number | null>;
        expect(nullResult.success).toBe(true);
        expect((nullResult as ParseSuccess<number | null>).value).toBeNull();

        // Invalid value should return error
        const invalidResult = parseValue('not number', nullableResult, 'test') as ParseResult<number | null>;
        expect(invalidResult.success).toBe(false);
      });
    });

    describe('edge cases', () => {
      it('should work with parseValue directly', () => {
        const numberResult = t.result(t.number);

        const success = parseValue(42, numberResult, 'test');
        expect(success).toEqual({ success: true, value: 42 });

        const failure = parseValue('not a number', numberResult, 'test');
        expect((failure as ParseResult<number>).success).toBe(false);
      });
    });
  });

  describe('Query integration', () => {
    const getContext = setupParsingTests();

    describe('basic usage', () => {
      it('should return success for valid value in query', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/item', { value: 42 });

        await testWithClient(client, async () => {
          const getItem = query(() => ({
            path: '/item',
            response: { value: t.result(t.number) },
          }));

          const relay = getItem();
          const result = await relay;

          expect(result.value).toEqual({ success: true, value: 42 });
        });
      });

      it('should return failure for invalid value in query', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/item', { value: 'not a number' });

        await testWithClient(client, async () => {
          const getItem = query(() => ({
            path: '/item',
            response: { value: t.result(t.number) },
          }));

          const relay = getItem();
          const result = await relay;

          expect(result.value.success).toBe(false);
          expect((result.value as ParseError).error).toBeInstanceOf(Error);
        });
      });
    });

    describe('with enums', () => {
      it('should return success for valid enum in query', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/item', { status: 'active' });

        await testWithClient(client, async () => {
          const Status = t.enum('active', 'inactive', 'pending');

          const getItem = query(() => ({
            path: '/item',
            response: { status: t.result(Status) },
          }));

          const relay = getItem();
          const result = await relay;

          expect(result.status).toEqual({ success: true, value: 'active' });
        });
      });

      it('should return failure for invalid enum in query', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/item', { status: 'unknown_status' });

        await testWithClient(client, async () => {
          const Status = t.enum('active', 'inactive', 'pending');

          const getItem = query(() => ({
            path: '/item',
            response: { status: t.result(Status) },
          }));

          const relay = getItem();
          const result = await relay;

          expect(result.status.success).toBe(false);
        });
      });
    });

    describe('within array', () => {
      it('should wrap each array item individually', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/items', { items: [1, 'invalid', 3] });

        await testWithClient(client, async () => {
          const getItems = query(() => ({
            path: '/items',
            response: { items: t.array(t.result(t.number)) },
          }));

          const relay = getItems();
          const result = await relay;

          expect(result.items).toHaveLength(3);
          expect(result.items[0]).toEqual({ success: true, value: 1 });
          expect(result.items[1].success).toBe(false);
          expect(result.items[2]).toEqual({ success: true, value: 3 });
        });
      });
    });

    describe('with formatted types', () => {
      it('should return success for valid date format', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/item', { date: '2024-01-15T10:30:00.000Z' });

        await testWithClient(client, async () => {
          const getItem = query(() => ({
            path: '/item',
            response: { date: t.result(t.format('date-time')) },
          }));

          const relay = getItem();
          const result = await relay;

          expect(result.date.success).toBe(true);
          expect((result.date as ParseSuccess<Date>).value).toBeInstanceOf(Date);
        });
      });

      it('should return failure for invalid date format', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/item', { date: 'not-a-date' });

        await testWithClient(client, async () => {
          const getItem = query(() => ({
            path: '/item',
            response: { date: t.result(t.format('date-time')) },
          }));

          const relay = getItem();
          const result = await relay;

          expect(result.date.success).toBe(false);
        });
      });
    });

    describe('within object', () => {
      it('should handle result inside nested object', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/data', {
          data: { name: 'Test', value: 42, optional: 'not a number' },
        });

        await testWithClient(client, async () => {
          const getData = query(() => ({
            path: '/data',
            response: {
              data: t.object({
                name: t.string,
                value: t.number,
                optional: t.result(t.number),
              }),
            },
          }));

          const relay = getData();
          const result = await relay;

          expect(result.data.name).toBe('Test');
          expect(result.data.value).toBe(42);
          expect(result.data.optional.success).toBe(false);
        });
      });
    });
  });

  describe('Entity integration', () => {
    const getContext = setupParsingTests();

    describe('with entities', () => {
      it('should return success for valid entity', async () => {
        const { client, mockFetch } = getContext();

        const UserEntity = entity(() => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
          email: t.string,
        }));

        mockFetch.get('/user', {
          user: { __typename: 'User', id: '1', name: 'Alice', email: 'alice@example.com' },
        });

        await testWithClient(client, async () => {
          const getUser = query(() => ({
            path: '/user',
            response: { user: t.result(UserEntity) },
          }));

          const relay = getUser();
          const result = await relay;

          expect(result.user.success).toBe(true);
          expect((result.user as ParseSuccess<unknown>).value).toHaveProperty('name', 'Alice');
        });
      });

      it('should return failure for entity missing id', async () => {
        const { client, mockFetch } = getContext();

        const UserEntity = entity(() => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
          email: t.string,
        }));

        mockFetch.get('/user', {
          user: { __typename: 'User', name: 'Bob', email: 'bob@example.com' },
        });

        await testWithClient(client, async () => {
          const getUser = query(() => ({
            path: '/user',
            response: { user: t.result(UserEntity) },
          }));

          const relay = getUser();
          const result = await relay;

          expect(result.user.success).toBe(false);
        });
      });

      it('should work with array of entities', async () => {
        const { client, mockFetch } = getContext();

        const UserEntity = entity(() => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
          email: t.string,
        }));

        mockFetch.get('/users', {
          users: [
            { __typename: 'User', id: '1', name: 'Alice', email: 'alice@example.com' },
            { __typename: 'User', name: 'Missing ID', email: 'no-id@example.com' },
            { __typename: 'User', id: '2', name: 'Bob', email: 'bob@example.com' },
          ],
        });

        await testWithClient(client, async () => {
          const getUsers = query(() => ({
            path: '/users',
            response: { users: t.array(t.result(UserEntity)) },
          }));

          const relay = getUsers();
          const result = await relay;

          expect(result.users).toHaveLength(3);
          expect(result.users[0].success).toBe(true);
          expect(result.users[1].success).toBe(false);
          expect(result.users[2].success).toBe(true);
        });
      });
    });

    describe('with entity unions', () => {
      it('should return success for valid union member', async () => {
        const { client, mockFetch } = getContext();

        const DogEntity = entity(() => ({
          __typename: t.typename('Dog'),
          id: t.id,
          breed: t.string,
        }));

        const CatEntity = entity(() => ({
          __typename: t.typename('Cat'),
          id: t.id,
          color: t.string,
        }));

        const PetUnion = t.union(DogEntity, CatEntity);

        mockFetch.get('/pet', {
          pet: { __typename: 'Dog', id: '1', breed: 'Golden Retriever' },
        });

        await testWithClient(client, async () => {
          const getPet = query(() => ({
            path: '/pet',
            response: { pet: t.result(PetUnion) },
          }));

          const relay = getPet();
          const result = await relay;

          expect(result.pet.success).toBe(true);
          expect((result.pet as ParseSuccess<unknown>).value).toHaveProperty('breed', 'Golden Retriever');
        });
      });

      it('should return failure for unknown typename in union', async () => {
        const { client, mockFetch } = getContext();

        const DogEntity = entity(() => ({
          __typename: t.typename('Dog'),
          id: t.id,
          breed: t.string,
        }));

        const CatEntity = entity(() => ({
          __typename: t.typename('Cat'),
          id: t.id,
          color: t.string,
        }));

        const PetUnion = t.union(DogEntity, CatEntity);

        mockFetch.get('/pet', {
          pet: { __typename: 'Bird', id: '1', species: 'Parrot' },
        });

        await testWithClient(client, async () => {
          const getPet = query(() => ({
            path: '/pet',
            response: { pet: t.result(PetUnion) },
          }));

          const relay = getPet();
          const result = await relay;

          expect(result.pet.success).toBe(false);
          expect((result.pet as ParseError).error.message).toContain('Unknown typename');
        });
      });
    });

    describe('within record', () => {
      it('should wrap each record value in entity context', async () => {
        const { client, kv } = getContext();

        const Config = entity(() => ({
          __typename: t.typename('Config'),
          id: t.id,
          values: t.record(t.result(t.number)),
        }));

        const QueryResult = t.object({ config: Config });

        const result = {
          config: {
            __typename: 'Config',
            id: 1,
            values: { a: 1, b: 'invalid', c: 3 },
          },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Config', 1, Config.shapeKey);
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        // Result wrappers are stored in the document
      });
    });
  });

  describe('Override fallback behavior', () => {
    const getContext = setupParsingTests();

    it('should return error for t.result(t.optional(t.number)) with invalid value', async () => {
      const { client, mockFetch } = getContext();
      mockFetch.get('/item', { value: 'not a number' });

      await testWithClient(client, async () => {
        const getItem = query(() => ({
          path: '/item',
          response: { value: t.result(t.optional(t.number)) },
        }));

        const relay = getItem();
        const result = await relay;

        // Should NOT fall back to undefined - should return error
        expect(result.value.success).toBe(false);
        expect((result.value as ParseError).error).toBeInstanceOf(Error);
      });
    });

    it('should return error for t.result(t.optional(t.format)) with invalid value', async () => {
      const { client, mockFetch } = getContext();
      mockFetch.get('/item', { date: 'not-a-date' });

      await testWithClient(client, async () => {
        const getItem = query(() => ({
          path: '/item',
          response: { date: t.result(t.optional(t.format('date-time'))) },
        }));

        const relay = getItem();
        const result = await relay;

        // Should NOT fall back to undefined - should return error
        expect(result.date.success).toBe(false);
        expect((result.date as ParseError).error).toBeInstanceOf(Error);
      });
    });

    it('should include errors in array with t.result items', async () => {
      const { client, mockFetch } = getContext();
      mockFetch.get('/items', {
        items: [1, 'invalid', 3],
      });

      await testWithClient(client, async () => {
        const getItems = query(() => ({
          path: '/items',
          response: { items: t.array(t.result(t.number)) },
        }));

        const relay = getItems();
        const result = await relay;

        // All items should be present (not filtered)
        expect(result.items).toHaveLength(3);
        expect(result.items[0]).toEqual({ success: true, value: 1 });
        expect(result.items[1].success).toBe(false);
        expect(result.items[2]).toEqual({ success: true, value: 3 });
      });
    });

    it('should return success with undefined for t.result(t.optional(t.number)) when value is undefined', async () => {
      const { client, mockFetch } = getContext();
      mockFetch.get('/item', { value: undefined });

      await testWithClient(client, async () => {
        const getItem = query(() => ({
          path: '/item',
          response: { value: t.result(t.optional(t.number)) },
        }));

        const relay = getItem();
        const result = await relay;

        // undefined IS a valid value for optional - should succeed
        expect(result.value.success).toBe(true);
        expect((result.value as ParseSuccess<number | undefined>).value).toBeUndefined();
      });
    });
  });

  describe('Type safety', () => {
    const getContext = setupParsingTests();

    it('should have correct types for success case', async () => {
      const { client, mockFetch } = getContext();

      mockFetch.get('/item', { value: 42 });

      await testWithClient(client, async () => {
        const getItem = query(() => ({
          path: '/item',
          response: { value: t.result(t.number) },
        }));

        const relay = getItem();
        const result = await relay;

        // TypeScript should infer this correctly
        if (result.value.success) {
          // value should be number
          const num: number = result.value.value;
          expect(typeof num).toBe('number');
        } else {
          // error should be Error
          const err: Error = result.value.error;
          expect(err).toBeInstanceOf(Error);
        }
      });
    });
  });
});
