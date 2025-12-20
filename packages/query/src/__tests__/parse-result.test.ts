import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryPersistentStore, SyncQueryStore } from '../stores/sync.js';
import { QueryClient } from '../QueryClient.js';
import { entity, t } from '../typeDefs.js';
import { query } from '../query.js';
import { createMockFetch, testWithClient } from './utils.js';
import { parseValue } from '../proxy.js';
import { ParseError, ParseResult, ParseSuccess } from '../types.js';

/**
 * t.result() Tests
 *
 * Tests for type-safe parse result wrapping:
 * - Returns { success: true, value } on successful parse
 * - Returns { success: false, error } on parse failure
 * - Works with primitives, enums, entities, and nested types
 */

describe('t.result()', () => {
  let client: QueryClient;
  let mockFetch: ReturnType<typeof createMockFetch>;

  beforeEach(() => {
    const store = new SyncQueryStore(new MemoryPersistentStore());
    mockFetch = createMockFetch();
    // No warn logger - suppress warnings in tests
    client = new QueryClient(store, { fetch: mockFetch as any });
  });

  afterEach(() => {
    client?.destroy();
  });

  describe('Primitive Types', () => {
    it('should return success for valid number', async () => {
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

    it('should return failure for number with string value', async () => {
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

    it('should return success for valid string', async () => {
      mockFetch.get('/item', { value: 'hello' });

      await testWithClient(client, async () => {
        const getItem = query(() => ({
          path: '/item',
          response: { value: t.result(t.string) },
        }));

        const relay = getItem();
        const result = await relay;

        expect(result.value).toEqual({ success: true, value: 'hello' });
      });
    });

    it('should return success for valid boolean', async () => {
      mockFetch.get('/item', { value: true });

      await testWithClient(client, async () => {
        const getItem = query(() => ({
          path: '/item',
          response: { value: t.result(t.boolean) },
        }));

        const relay = getItem();
        const result = await relay;

        expect(result.value).toEqual({ success: true, value: true });
      });
    });
  });

  describe('Enum Types', () => {
    it('should return success for valid enum value', async () => {
      const Status = t.enum('active', 'inactive', 'pending');

      mockFetch.get('/item', { status: 'active' });

      await testWithClient(client, async () => {
        const getItem = query(() => ({
          path: '/item',
          response: { status: t.result(Status) },
        }));

        const relay = getItem();
        const result = await relay;

        expect(result.status).toEqual({ success: true, value: 'active' });
      });
    });

    it('should return failure for unknown enum value', async () => {
      const Status = t.enum('active', 'inactive', 'pending');

      mockFetch.get('/item', { status: 'unknown_status' });

      await testWithClient(client, async () => {
        const getItem = query(() => ({
          path: '/item',
          response: { status: t.result(Status) },
        }));

        const relay = getItem();
        const result = await relay;

        expect(result.status.success).toBe(false);
        expect((result.status as ParseError).error).toBeInstanceOf(Error);
      });
    });
  });

  describe('Array with parseResult', () => {
    it('should wrap each item in array individually', async () => {
      mockFetch.get('/items', {
        items: [1, 'not a number', 3, null, 5],
      });

      await testWithClient(client, async () => {
        const getItems = query(() => ({
          path: '/items',
          response: { items: t.array(t.result(t.number)) },
        }));

        const relay = getItems();
        const result = await relay;

        // Each item should be individually wrapped
        expect(result.items).toHaveLength(5);
        expect(result.items[0]).toEqual({ success: true, value: 1 });
        expect(result.items[1].success).toBe(false);
        expect(result.items[2]).toEqual({ success: true, value: 3 });
        expect(result.items[3].success).toBe(false);
        expect(result.items[4]).toEqual({ success: true, value: 5 });
      });
    });

    it('should work with enum arrays', async () => {
      const Status = t.enum('active', 'inactive');

      mockFetch.get('/statuses', {
        statuses: ['active', 'unknown', 'inactive', 'new_status'],
      });

      await testWithClient(client, async () => {
        const getStatuses = query(() => ({
          path: '/statuses',
          response: { statuses: t.array(t.result(Status)) },
        }));

        const relay = getStatuses();
        const result = await relay;

        expect(result.statuses).toHaveLength(4);
        expect(result.statuses[0]).toEqual({ success: true, value: 'active' });
        expect(result.statuses[1].success).toBe(false);
        expect(result.statuses[2]).toEqual({ success: true, value: 'inactive' });
        expect(result.statuses[3].success).toBe(false);
      });
    });
  });

  describe('Entity Types', () => {
    const UserEntity = entity(() => ({
      __typename: t.typename('User'),
      id: t.id,
      name: t.string,
      email: t.string,
    }));

    it('should return success with entity proxy for valid entity', async () => {
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
        expect((result.user as ParseSuccess<unknown>).value).toHaveProperty('email', 'alice@example.com');
      });
    });

    it('should return failure for entity missing id', async () => {
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
        expect((result.user as ParseError).error).toBeInstanceOf(Error);
      });
    });

    it('should work with array of entities', async () => {
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

  describe('Union Types in parseResult', () => {
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

    it('should return success for valid union member', async () => {
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

  describe('Formatted Types', () => {
    it('should return success for valid date format', async () => {
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
      mockFetch.get('/item', { date: 'not-a-date' });

      await testWithClient(client, async () => {
        const getItem = query(() => ({
          path: '/item',
          response: { date: t.result(t.format('date-time')) },
        }));

        const relay = getItem();
        const result = await relay;

        expect(result.date.success).toBe(false);
        expect((result.date as ParseError).error).toBeInstanceOf(Error);
      });
    });
  });

  describe('Nested parseResult', () => {
    it('should handle parseResult inside object', async () => {
      mockFetch.get('/data', {
        data: {
          name: 'Test',
          value: 42,
          optional: 'not a number',
        },
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

    it('should handle nested object inside parseResult', async () => {
      mockFetch.get('/data', {
        wrapper: {
          inner: {
            value: 'hello',
          },
        },
      });

      await testWithClient(client, async () => {
        const getData = query(() => ({
          path: '/data',
          response: {
            wrapper: t.result(
              t.object({
                inner: t.object({
                  value: t.string,
                }),
              }),
            ),
          },
        }));

        const relay = getData();
        const result = await relay;

        expect(result.wrapper.success).toBe(true);
        expect((result.wrapper as ParseSuccess<{ inner: { value: string } }>).value.inner.value).toBe('hello');
      });
    });
  });

  describe('Direct parseValue usage', () => {
    it('should work with parseValue directly', () => {
      const numberResult = t.result(t.number);

      const success = parseValue(42, numberResult, 'test');
      expect(success).toEqual({ success: true, value: 42 });

      const failure = parseValue('not a number', numberResult, 'test');
      expect((failure as ParseResult<number>).success).toBe(false);
    });
  });

  describe('Override fallback behavior', () => {
    it('should return error for t.result(t.optional(t.number)) with invalid value', async () => {
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
    it('should have correct types for success case', async () => {
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
