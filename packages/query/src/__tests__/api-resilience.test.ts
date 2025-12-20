import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryPersistentStore, SyncQueryStore } from '../stores/sync.js';
import { QueryClient } from '../QueryClient.js';
import { entity, t } from '../typeDefs.js';
import { query } from '../query.js';
import { createMockFetch, testWithClient } from './utils.js';
import { parseValue, parseArrayValue } from '../proxy.js';

/**
 * API Resilience Tests
 *
 * Tests fault tolerance for additive API changes:
 * - Array filtering for parse failures
 * - Undefined fallback for optional types
 * - Warning logger integration
 */

describe('API Resilience', () => {
  let client: QueryClient;
  let mockFetch: ReturnType<typeof createMockFetch>;
  let warnLogger: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const store = new SyncQueryStore(new MemoryPersistentStore());
    mockFetch = createMockFetch();
    warnLogger = vi.fn();
    client = new QueryClient(store, { fetch: mockFetch as any, log: { warn: warnLogger } });
  });

  afterEach(() => {
    client?.destroy();
  });

  describe('Array Filtering', () => {
    it('should filter out items with wrong primitive type', async () => {
      mockFetch.get('/numbers', {
        numbers: [1, 2, 'not a number', 4, true, 6],
      });

      await testWithClient(client, async () => {
        const getNumbers = query(() => ({
          path: '/numbers',
          response: { numbers: t.array(t.number) },
        }));

        const relay = getNumbers();
        const result = await relay;

        // Should have filtered out 'not a number' and true
        expect(result.numbers).toEqual([1, 2, 4, 6]);
        expect(warnLogger).toHaveBeenCalled();
      });
    });

    it('should filter out items with unknown enum value', async () => {
      const Status = t.enum('active', 'inactive', 'pending');

      mockFetch.get('/statuses', {
        statuses: ['active', 'unknown_status', 'inactive', 'new_status', 'pending'],
      });

      await testWithClient(client, async () => {
        const getStatuses = query(() => ({
          path: '/statuses',
          response: { statuses: t.array(Status) },
        }));

        const relay = getStatuses();
        const result = await relay;

        // Should have filtered out 'unknown_status' and 'new_status'
        expect(result.statuses).toEqual(['active', 'inactive', 'pending']);
        expect(warnLogger).toHaveBeenCalledTimes(2);
      });
    });

    it('should filter out items with unknown typename in union', async () => {
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

      mockFetch.get('/posts', {
        posts: [
          { __typename: 'TextPost', id: '1', content: 'Hello' },
          { __typename: 'VideoPost', id: '2', videoUrl: '/video.mp4' }, // Unknown type
          { __typename: 'ImagePost', id: '3', url: '/img.jpg' },
          { __typename: 'AudioPost', id: '4', audioUrl: '/audio.mp3' }, // Unknown type
        ],
      });

      await testWithClient(client, async () => {
        const getPosts = query(() => ({
          path: '/posts',
          response: { posts: t.array(PostUnion) },
        }));

        const relay = getPosts();
        const result = await relay;

        // Should have filtered out VideoPost and AudioPost
        expect(result.posts).toHaveLength(2);
        expect(result.posts[0].__typename).toBe('TextPost');
        expect(result.posts[1].__typename).toBe('ImagePost');
        expect(warnLogger).toHaveBeenCalledTimes(2);
      });
    });

    it('should filter out items with invalid date format', async () => {
      mockFetch.get('/dates', {
        dates: ['2024-01-15', 'not-a-date', '2024-06-20', 'invalid'],
      });

      await testWithClient(client, async () => {
        const getDates = query(() => ({
          path: '/dates',
          response: { dates: t.array(t.format('date')) },
        }));

        const relay = getDates();
        const result = await relay;

        // Should have filtered out 'not-a-date' and 'invalid'
        expect(result.dates).toHaveLength(2);
        expect(result.dates[0]).toBeInstanceOf(Date);
        expect(result.dates[1]).toBeInstanceOf(Date);
        expect(warnLogger).toHaveBeenCalledTimes(2);
      });
    });

    it('should handle nested arrays with filtering at each level', async () => {
      mockFetch.get('/nested', {
        matrix: [
          [1, 2, 'bad', 4],
          ['all', 'bad', 'values'],
          [5, 6, 7],
        ],
      });

      await testWithClient(client, async () => {
        const getNested = query(() => ({
          path: '/nested',
          response: { matrix: t.array(t.array(t.number)) },
        }));

        const relay = getNested();
        const result = await relay;

        // Inner arrays should have invalid items filtered
        expect(result.matrix).toEqual([[1, 2, 4], [], [5, 6, 7]]);
      });
    });

    it('should return empty array when all items are filtered', async () => {
      mockFetch.get('/numbers', {
        numbers: ['a', 'b', 'c'],
      });

      await testWithClient(client, async () => {
        const getNumbers = query(() => ({
          path: '/numbers',
          response: { numbers: t.array(t.number) },
        }));

        const relay = getNumbers();
        const result = await relay;

        expect(result.numbers).toEqual([]);
        expect(warnLogger).toHaveBeenCalledTimes(3);
      });
    });

    it('should filter entities with missing required ID', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      mockFetch.get('/users', {
        users: [
          { __typename: 'User', id: 1, name: 'Alice' },
          { __typename: 'User', name: 'Missing ID' }, // No id field
          { __typename: 'User', id: 3, name: 'Charlie' },
        ],
      });

      await testWithClient(client, async () => {
        const getUsers = query(() => ({
          path: '/users',
          response: { users: t.array(User) },
        }));

        const relay = getUsers();
        const result = await relay;

        // Should have filtered out the user without id
        expect(result.users).toHaveLength(2);
        expect(result.users[0].name).toBe('Alice');
        expect(result.users[1].name).toBe('Charlie');
        expect(warnLogger).toHaveBeenCalled();
      });
    });
  });

  describe('Undefined Fallback', () => {
    it('should return undefined for optional field with invalid enum', () => {
      const OptionalStatus = t.optional(t.enum('active', 'inactive'));

      const result = parseValue('unknown_status', OptionalStatus, 'test.status', false, warnLogger);

      expect(result).toBeUndefined();
      expect(warnLogger).toHaveBeenCalledWith(
        'Invalid value for optional type, defaulting to undefined',
        expect.objectContaining({ value: 'unknown_status', path: 'test.status' }),
      );
    });

    it('should return undefined for optional field with wrong type', () => {
      const OptionalNumber = t.optional(t.number);

      const result = parseValue('not a number', OptionalNumber, 'test.count', false, warnLogger);

      expect(result).toBeUndefined();
      expect(warnLogger).toHaveBeenCalled();
    });

    it('should return undefined for nullish field with invalid value', () => {
      const NullishString = t.nullish(t.string);

      const result = parseValue(12345, NullishString, 'test.name', false, warnLogger);

      expect(result).toBeUndefined();
      expect(warnLogger).toHaveBeenCalled();
    });

    it('should still throw for required field with invalid value', () => {
      const RequiredNumber = t.number;

      expect(() => {
        parseValue('not a number', RequiredNumber, 'test.count');
      }).toThrow(/Validation error/);
    });

    it('should still throw for required enum with invalid value', () => {
      const RequiredStatus = t.enum('active', 'inactive');

      expect(() => {
        parseValue('unknown', RequiredStatus, 'test.status');
      }).toThrow(/Validation error/);
    });

    it('should return undefined for optional field with invalid date format', () => {
      const OptionalDate = t.optional(t.format('date'));

      const result = parseValue('not-a-date', OptionalDate, 'test.date', false, warnLogger);

      expect(result).toBeUndefined();
      expect(warnLogger).toHaveBeenCalledWith(
        'Invalid formatted value for optional type, defaulting to undefined',
        expect.objectContaining({ path: 'test.date' }),
      );
    });

    it('should work with optional fields in queries', async () => {
      mockFetch.get('/item', {
        name: 'Test',
        status: 'unknown_new_status', // Unknown enum value
        count: 'not a number', // Wrong type
      });

      await testWithClient(client, async () => {
        const getItem = query(() => ({
          path: '/item',
          response: {
            name: t.string,
            status: t.optional(t.enum('active', 'inactive')),
            count: t.optional(t.number),
          },
        }));

        const relay = getItem();
        const result = await relay;

        expect(result.name).toBe('Test');
        expect(result.status).toBeUndefined();
        expect(result.count).toBeUndefined();
        expect(warnLogger).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('Warning Logger', () => {
    it('should receive correct context for filtered array items', async () => {
      mockFetch.get('/numbers', {
        numbers: [1, 'bad', 3],
      });

      await testWithClient(client, async () => {
        const getNumbers = query(() => ({
          path: '/numbers',
          response: { numbers: t.array(t.number) },
        }));

        const relay = getNumbers();
        await relay;

        expect(warnLogger).toHaveBeenCalledWith(
          'Failed to parse array item, filtering out',
          expect.objectContaining({
            index: 1,
            value: 'bad',
            error: expect.any(String),
          }),
        );
      });
    });

    it('should receive correct context for undefined fallbacks', () => {
      const OptionalNumber = t.optional(t.number);

      parseValue('bad', OptionalNumber, 'my.path', false, warnLogger);

      expect(warnLogger).toHaveBeenCalledWith(
        'Invalid value for optional type, defaulting to undefined',
        expect.objectContaining({
          value: 'bad',
          path: 'my.path',
        }),
      );
    });

    it('should not log when no warn logger is configured', async () => {
      // Create a new client without a warn logger
      const storeNoWarn = new SyncQueryStore(new MemoryPersistentStore());
      const clientNoWarn = new QueryClient(storeNoWarn, { fetch: mockFetch as any });

      mockFetch.get('/numbers', {
        numbers: [1, 'bad', 3],
      });

      try {
        await testWithClient(clientNoWarn, async () => {
          const getNumbers = query(() => ({
            path: '/numbers',
            response: { numbers: t.array(t.number) },
          }));

          const relay = getNumbers();
          const result = await relay;

          // Should still filter, just not log
          expect(result.numbers).toEqual([1, 3]);
          expect(warnLogger).not.toHaveBeenCalled();
        });
      } finally {
        clientNoWarn.destroy();
      }
    });
  });

  describe('Non-Array Errors Still Throw', () => {
    it('should throw for required field in object with invalid value', async () => {
      mockFetch.get('/item', {
        count: 'not a number',
      });

      await testWithClient(client, async () => {
        const getItem = query(() => ({
          path: '/item',
          response: { count: t.number },
        }));

        const relay = getItem();

        await expect(relay).rejects.toThrow(/Validation error/);
      });
    });

    it('should throw for required enum in object with unknown value', async () => {
      mockFetch.get('/item', {
        status: 'unknown',
      });

      await testWithClient(client, async () => {
        const getItem = query(() => ({
          path: '/item',
          response: { status: t.enum('active', 'inactive') },
        }));

        const relay = getItem();

        await expect(relay).rejects.toThrow(/Validation error/);
      });
    });
  });
});
