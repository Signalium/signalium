import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SyncQueryStore, MemoryPersistentStore } from '../QueryStore.js';
import { QueryClient } from '../QueryClient.js';
import { entity, t, registerFormat } from '../typeDefs.js';
import { query } from '../query.js';
import type { ExtractType } from '../types.js';
import { createMockFetch, testWithClient } from './utils.js';
import { hashValue } from 'signalium/utils';
import { valueKeyFor, updatedAtKeyFor, refIdsKeyFor, refCountKeyFor } from '../QueryStore.js';
import { queryKeyForFn } from '../query.js';

// Helper to set up a query result in the store (similar to caching-persistence.test.ts)
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
function setQuery(
  kv: MemoryPersistentStore,
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  queryFn: Function,
  params: unknown,
  result: unknown,
  refIds?: Set<number>,
) {
  if (typeof params === 'object' && params !== null && Object.keys(params).length === 0) {
    params = undefined;
  }

  const queryKey = queryKeyForFn(queryFn, params);
  kv.setString(valueKeyFor(queryKey), JSON.stringify(result));

  if (refIds !== undefined && refIds.size > 0) {
    kv.setBuffer(refIdsKeyFor(queryKey), new Uint32Array(refIds));
    for (const refId of refIds) {
      const refCountKey = refCountKeyFor(refId);
      const currentCount = kv.getNumber(refCountKey) ?? 0;
      kv.setNumber(refCountKey, currentCount + 1);
    }
  }

  kv.setNumber(updatedAtKeyFor(queryKey), Date.now());
}

function getDocument(kv: MemoryPersistentStore, key: number): unknown | undefined {
  const value = kv.getString(valueKeyFor(key));
  return value === undefined ? undefined : JSON.parse(value);
}

/**
 * Format System Tests
 *
 * Tests the format system including:
 * - Lazy parsing (values parsed on access, not during initial parsing)
 * - Caching (parsed values cached for subsequent accesses)
 * - Serialization (formatted values serialize back to original format)
 * - Type inference (t.format('date-time') typed as Date)
 * - Built-in formats (date, date-time)
 * - Module augmentation (custom formats)
 */

// Extend the format registry for testing custom formats
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace SignaliumQuery {
    interface FormatRegistry {
      price: number;
      money: { amount: number; currency: string };
    }
  }
}

describe('Format System', () => {
  let client: QueryClient;
  let mockFetch: ReturnType<typeof createMockFetch>;
  let kv: MemoryPersistentStore;
  let store: SyncQueryStore;

  beforeEach(() => {
    kv = new MemoryPersistentStore();
    store = new SyncQueryStore(kv);
    mockFetch = createMockFetch();
    client = new QueryClient(store, { fetch: mockFetch as any });
  });

  afterEach(() => {
    client?.destroy();
  });

  describe('Built-in Formats', () => {
    describe('date-time format', () => {
      it('should parse date-time strings lazily on access', async () => {
        const User = entity(() => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
          createdAt: t.format('date-time'),
        }));

        const isoString = '2024-01-15T10:30:00.000Z';
        mockFetch.get('/user/[id]', {
          user: {
            __typename: 'User',
            id: '1',
            name: 'Alice',
            createdAt: isoString,
          },
        });

        await testWithClient(client, async () => {
          const getUser = query(() => ({
            path: '/user/[id]',
            response: { user: User },
          }));

          const relay = getUser({ id: '1' });
          const result = await relay;

          // Value should be parsed lazily - should be a Date object
          expect(result.user.createdAt).toBeInstanceOf(Date);
          expect(result.user.createdAt.toISOString()).toBe(isoString);
        });
      });

      it('should cache parsed date-time values', async () => {
        const User = entity(() => ({
          __typename: t.typename('User'),
          id: t.id,
          createdAt: t.format('date-time'),
        }));

        const isoString = '2024-01-15T10:30:00.000Z';
        mockFetch.get('/user/[id]', {
          user: {
            __typename: 'User',
            id: '1',
            createdAt: isoString,
          },
        });

        await testWithClient(client, async () => {
          const getUser = query(() => ({
            path: '/user/[id]',
            response: { user: User },
          }));

          const relay = getUser({ id: '1' });
          const result = await relay;

          const firstAccess = result.user.createdAt;
          const secondAccess = result.user.createdAt;

          // Should return the same Date instance (cached)
          expect(firstAccess).toBe(secondAccess);
        });
      });

      it('should serialize date-time values as raw strings in store', async () => {
        const User = entity(() => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
          createdAt: t.format('date-time'),
        }));

        const isoString = '2024-01-15T10:30:00.000Z';
        mockFetch.get('/user/[id]', {
          user: {
            __typename: 'User',
            id: '1',
            name: 'Alice',
            createdAt: isoString,
          },
        });

        await testWithClient(client, async () => {
          const getUser = query(() => ({
            path: '/user/[id]',
            response: { user: User },
          }));

          const relay = getUser({ id: '1' });
          await relay;

          // Access the field to trigger parsing
          const _ = relay.value!.user.createdAt;

          // Verify entity is stored with raw string value
          const userKey = hashValue('User:1');
          const entityData = getDocument(kv, userKey) as Record<string, unknown>;

          expect(entityData.createdAt).toBe(isoString);
          expect(typeof entityData.createdAt).toBe('string');
        });
      });

      it('should handle invalid date-time strings', async () => {
        const User = entity(() => ({
          __typename: t.typename('User'),
          id: t.id,
          createdAt: t.format('date-time'),
        }));

        mockFetch.get('/user/[id]', {
          user: {
            __typename: 'User',
            id: '1',
            createdAt: 'invalid-date',
          },
        });

        await testWithClient(client, async () => {
          const getUser = query(() => ({
            path: '/user/[id]',
            response: { user: User },
          }));

          const relay = getUser({ id: '1' });
          const result = await relay;

          // Should throw error when accessing invalid date
          expect(() => {
            const _ = result.user.createdAt;
          }).toThrow();
        });
      });
    });

    describe('date format', () => {
      it('should parse date strings lazily on access', async () => {
        const User = entity(() => ({
          __typename: t.typename('User'),
          id: t.id,
          birthDate: t.format('date'),
        }));

        const dateString = '2024-01-15';
        mockFetch.get('/user/[id]', {
          user: {
            __typename: 'User',
            id: '1',
            birthDate: dateString,
          },
        });

        await testWithClient(client, async () => {
          const getUser = query(() => ({
            path: '/user/[id]',
            response: { user: User },
          }));

          const relay = getUser({ id: '1' });
          const result = await relay;

          // Value should be parsed lazily - should be a Date object
          expect(result.user.birthDate).toBeInstanceOf(Date);

          // Verify entity is stored with raw string value
          const userKey = hashValue('User:1');
          const entityData = getDocument(kv, userKey) as Record<string, unknown>;
          expect(entityData.birthDate).toBe(dateString);
        });
      });

      it('should serialize date values as raw strings in store', async () => {
        const User = entity(() => ({
          __typename: t.typename('User'),
          id: t.id,
          birthDate: t.format('date'),
        }));

        const dateString = '2024-01-15';
        mockFetch.get('/user/[id]', {
          user: {
            __typename: 'User',
            id: '1',
            birthDate: dateString,
          },
        });

        await testWithClient(client, async () => {
          const getUser = query(() => ({
            path: '/user/[id]',
            response: { user: User },
          }));

          const relay = getUser({ id: '1' });
          await relay;

          // Access the field to trigger parsing
          const _ = relay.value!.user.birthDate;

          // Verify entity is stored with raw string value
          const userKey = hashValue('User:1');
          const entityData = getDocument(kv, userKey) as Record<string, unknown>;
          expect(entityData.birthDate).toBe(dateString);
          expect(typeof entityData.birthDate).toBe('string');
        });
      });
    });
  });

  describe('Type Inference', () => {
    it('should type t.format("date-time") as Date', () => {
      const formatType = t.format('date-time');

      // Type check - ExtractType should extract Date
      type FormatType = ExtractType<typeof formatType>;
      const _typeCheck: FormatType = new Date();

      // Runtime check - formatType is a number (mask)
      expect(typeof formatType).toBe('number');
    });

    it('should type entity fields with formats correctly', () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        createdAt: t.format('date-time'),
        birthDate: t.format('date'),
      }));

      // Type check - createdAt and birthDate should be Date
      type UserType = ExtractType<typeof User.shape.createdAt>;
      type BirthDateType = ExtractType<typeof User.shape.birthDate>;

      const _createdAtCheck: UserType = new Date();
      const _birthDateCheck: BirthDateType = new Date();
    });
  });

  describe('Custom Formats', () => {
    it('should allow registering custom formats', async () => {
      // Register a custom format
      registerFormat(
        'price',
        t.string,
        value => parseFloat(value.replace('$', '')),
        value => `$${value.toFixed(2)}`,
      );

      const Product = entity(() => ({
        __typename: t.typename('Product'),
        id: t.id,
        name: t.string,
        price: t.format('price'),
      }));

      mockFetch.get('/product/[id]', {
        product: {
          __typename: 'Product',
          id: '1',
          name: 'Widget',
          price: '$10.99',
        },
      });

      await testWithClient(client, async () => {
        const getProduct = query(() => ({
          path: '/product/[id]',
          response: { product: Product },
        }));

        const relay = getProduct({ id: '1' });
        const result = await relay;

        // Should parse to number
        expect(result.product.price).toBe(10.99);
        expect(typeof result.product.price).toBe('number');

        // Verify entity is stored with raw string value
        const productKey = hashValue('Product:1');
        const entityData = getDocument(kv, productKey) as Record<string, unknown>;
        expect(entityData.price).toBe('$10.99');
        expect(typeof entityData.price).toBe('string');
      });
    });
  });

  describe('Error Handling', () => {
    it('should throw error for unregistered format', () => {
      expect(() => {
        t.format('unregistered-format' as any);
      }).toThrow('Format unregistered-format not registered');
    });

    it('should show format name in error messages', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        createdAt: t.format('date-time'),
      }));

      mockFetch.get('/user/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          createdAt: 12345, // Wrong type - should be string
        },
      });

      await testWithClient(client, async () => {
        const getUser = query(() => ({
          path: '/user/[id]',
          response: { user: User },
        }));

        const relay = getUser({ id: '1' });
        const result = await relay;

        // Should throw validation error mentioning the format when accessing the field
        expect(() => {
          const _ = result.user.createdAt;
        }).toThrow(/expected "date-time"/);
      });
    });
  });

  describe('Lazy Parsing Behavior', () => {
    it('should not parse format until field is accessed', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        createdAt: t.format('date-time'),
      }));

      const isoString = '2024-01-15T10:30:00.000Z';
      mockFetch.get('/user/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          createdAt: isoString,
        },
      });

      await testWithClient(client, async () => {
        const getUser = query(() => ({
          path: '/user/[id]',
          response: { user: User },
        }));

        const relay = getUser({ id: '1' });
        const result = await relay;

        // At this point, createdAt should still be a string in the raw data
        // But when accessed, it should be parsed to Date
        const dateValue = result.user.createdAt;
        expect(dateValue).toBeInstanceOf(Date);
      });
    });

    it('should cache parsed values across multiple accesses', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        createdAt: t.format('date-time'),
      }));

      const isoString = '2024-01-15T10:30:00.000Z';
      mockFetch.get('/user/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          createdAt: isoString,
        },
      });

      await testWithClient(client, async () => {
        const getUser = query(() => ({
          path: '/user/[id]',
          response: { user: User },
        }));

        const relay = getUser({ id: '1' });
        const result = await relay;

        const first = result.user.createdAt;
        const second = result.user.createdAt;
        const third = result.user.createdAt;

        // All should be the same instance (cached)
        expect(first).toBe(second);
        expect(second).toBe(third);
      });
    });
  });

  describe('Store Serialization', () => {
    it('should serialize formatted fields as raw values in store', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
        createdAt: t.format('date-time'),
        birthDate: t.format('date'),
      }));

      const isoString = '2024-01-15T10:30:00.000Z';
      const dateString = '1990-05-20';

      mockFetch.get('/user/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          name: 'Alice',
          createdAt: isoString,
          birthDate: dateString,
        },
      });

      await testWithClient(client, async () => {
        const getUser = query(() => ({
          path: '/user/[id]',
          response: { user: User },
        }));

        const relay = getUser({ id: '1' });
        await relay;

        // Access fields to trigger parsing
        const _createdAt = relay.value!.user.createdAt;
        const _birthDate = relay.value!.user.birthDate;

        // Verify entity is stored with raw string values
        const userKey = hashValue('User:1');
        const entityData = getDocument(kv, userKey) as Record<string, unknown>;

        expect(entityData.createdAt).toBe(isoString);
        expect(entityData.birthDate).toBe(dateString);
        expect(entityData.name).toBe('Alice');
        expect(typeof entityData.createdAt).toBe('string');
        expect(typeof entityData.birthDate).toBe('string');
      });
    });

    it('should serialize unaccessed formatted fields as raw values in store', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        createdAt: t.format('date-time'),
      }));

      const isoString = '2024-01-15T10:30:00.000Z';
      mockFetch.get('/user/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          createdAt: isoString,
        },
      });

      await testWithClient(client, async () => {
        const getUser = query(() => ({
          path: '/user/[id]',
          response: { user: User },
        }));

        const relay = getUser({ id: '1' });
        await relay;

        // Don't access createdAt - check store directly
        const userKey = hashValue('User:1');
        const entityData = getDocument(kv, userKey) as Record<string, unknown>;

        // Should be stored as raw string value
        expect(entityData.createdAt).toBe(isoString);
        expect(typeof entityData.createdAt).toBe('string');
      });
    });
  });

  describe('Entity Updates with Formats', () => {
    describe('date-time format updates', () => {
      it('should update date-time values when entity is refetched', async () => {
        const User = entity(() => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
          createdAt: t.format('date-time'),
        }));

        const initialIsoString = '2024-01-15T10:30:00.000Z';
        mockFetch.get('/user/[id]', {
          user: {
            __typename: 'User',
            id: '1',
            name: 'Alice',
            createdAt: initialIsoString,
          },
        });

        await testWithClient(client, async () => {
          const getUser = query(() => ({
            path: '/user/[id]',
            response: { user: User },
          }));

          const relay = getUser({ id: '1' });
          const result1 = await relay;

          // Access and verify initial value
          const initialDate = result1.user.createdAt;
          expect(initialDate).toBeInstanceOf(Date);
          expect(initialDate.toISOString()).toBe(initialIsoString);

          // Update the mock to return a new date
          const updatedIsoString = '2024-02-20T15:45:30.000Z';
          mockFetch.get('/user/[id]', {
            user: {
              __typename: 'User',
              id: '1',
              name: 'Alice',
              createdAt: updatedIsoString,
            },
          });

          // Refetch the query
          const result2 = await relay.refetch();

          // Should get the updated date
          const updatedDate = result2.user.createdAt;
          expect(updatedDate).toBeInstanceOf(Date);
          expect(updatedDate.toISOString()).toBe(updatedIsoString);
          expect(updatedDate).not.toBe(initialDate); // Should be a new Date instance

          // The original result should also reflect the update (reactivity)
          const reactiveDate = result1.user.createdAt;
          expect(reactiveDate.toISOString()).toBe(updatedIsoString);
        });
      });

      it('should clear cached date-time values when entity is updated', async () => {
        const User = entity(() => ({
          __typename: t.typename('User'),
          id: t.id,
          createdAt: t.format('date-time'),
        }));

        const initialIsoString = '2024-01-15T10:30:00.000Z';
        mockFetch.get('/user/[id]', {
          user: {
            __typename: 'User',
            id: '1',
            createdAt: initialIsoString,
          },
        });

        await testWithClient(client, async () => {
          const getUser = query(() => ({
            path: '/user/[id]',
            response: { user: User },
          }));

          const relay = getUser({ id: '1' });
          const result = await relay;

          // Access and cache the initial value
          const firstAccess = result.user.createdAt;
          const secondAccess = result.user.createdAt;
          expect(firstAccess).toBe(secondAccess); // Should be cached

          // Update the entity
          const updatedIsoString = '2024-02-20T15:45:30.000Z';
          mockFetch.get('/user/[id]', {
            user: {
              __typename: 'User',
              id: '1',
              createdAt: updatedIsoString,
            },
          });

          await relay.refetch();

          // Access again - should get new value
          const thirdAccess = result.user.createdAt;
          expect(thirdAccess.toISOString()).toBe(updatedIsoString);
          expect(thirdAccess).not.toBe(firstAccess); // Should be a new Date instance
        });
      });
    });

    describe('date format updates', () => {
      it('should update date values when entity is refetched', async () => {
        const User = entity(() => ({
          __typename: t.typename('User'),
          id: t.id,
          birthDate: t.format('date'),
        }));

        const initialDateString = '1990-05-20';
        mockFetch.get('/user/[id]', {
          user: {
            __typename: 'User',
            id: '1',
            birthDate: initialDateString,
          },
        });

        await testWithClient(client, async () => {
          const getUser = query(() => ({
            path: '/user/[id]',
            response: { user: User },
          }));

          const relay = getUser({ id: '1' });
          const result1 = await relay;

          // Access and verify initial value
          const initialDate = result1.user.birthDate;
          expect(initialDate).toBeInstanceOf(Date);

          // Update the mock
          const updatedDateString = '1995-12-25';
          mockFetch.get('/user/[id]', {
            user: {
              __typename: 'User',
              id: '1',
              birthDate: updatedDateString,
            },
          });

          // Refetch
          const result2 = await relay.refetch();

          // Should get the updated date
          const updatedDate = result2.user.birthDate;
          expect(updatedDate).toBeInstanceOf(Date);

          // Verify entity is stored with updated raw string value
          const userKey = hashValue('User:1');
          const entityData = getDocument(kv, userKey) as Record<string, unknown>;
          expect(entityData.birthDate).toBe(updatedDateString);
        });
      });
    });

    describe('custom format updates', () => {
      it('should update custom formatted values when entity is refetched', async () => {
        // Register a custom format
        registerFormat(
          'price',
          t.string,
          value => parseFloat(value.replace('$', '')),
          value => `$${value.toFixed(2)}`,
        );

        const Product = entity(() => ({
          __typename: t.typename('Product'),
          id: t.id,
          name: t.string,
          price: t.format('price'),
        }));

        mockFetch.get('/product/[id]', {
          product: {
            __typename: 'Product',
            id: '1',
            name: 'Widget',
            price: '$10.99',
          },
        });

        await testWithClient(client, async () => {
          const getProduct = query(() => ({
            path: '/product/[id]',
            response: { product: Product },
          }));

          const relay = getProduct({ id: '1' });
          const result1 = await relay;

          // Access and verify initial value
          const initialPrice = result1.product.price;
          expect(initialPrice).toBe(10.99);
          expect(typeof initialPrice).toBe('number');

          // Update the mock
          mockFetch.get('/product/[id]', {
            product: {
              __typename: 'Product',
              id: '1',
              name: 'Widget',
              price: '$25.50',
            },
          });

          // Refetch
          const result2 = await relay.refetch();

          // Should get the updated price
          const updatedPrice = result2.product.price;
          expect(updatedPrice).toBe(25.5);
          expect(updatedPrice).not.toBe(initialPrice);

          // Verify entity is stored with updated raw string value
          const productKey = hashValue('Product:1');
          const entityData = getDocument(kv, productKey) as Record<string, unknown>;
          expect(entityData.price).toBe('$25.50');
        });
      });

      it('should clear cached custom formatted values when entity is updated', async () => {
        // Register a custom format
        registerFormat(
          'money',
          t.string,
          value => {
            const match = value.match(/^(\d+\.?\d*)\s*(\w+)$/);
            if (!match) throw new Error(`Invalid money format: ${value}`);
            return { amount: parseFloat(match[1]), currency: match[2] };
          },
          (value: { amount: number; currency: string }) => `${value.amount} ${value.currency}`,
        );

        const Product = entity(() => ({
          __typename: t.typename('Product'),
          id: t.id,
          price: t.format('money'),
        }));

        mockFetch.get('/product/[id]', {
          product: {
            __typename: 'Product',
            id: '1',
            price: '10.99 USD',
          },
        });

        await testWithClient(client, async () => {
          const getProduct = query(() => ({
            path: '/product/[id]',
            response: { product: Product },
          }));

          const relay = getProduct({ id: '1' });
          const result = await relay;

          // Access and cache the initial value
          const firstAccess = result.product.price;
          const secondAccess = result.product.price;
          expect(firstAccess).toBe(secondAccess); // Should be cached
          expect(firstAccess.amount).toBe(10.99);
          expect(firstAccess.currency).toBe('USD');

          // Update the entity
          mockFetch.get('/product/[id]', {
            product: {
              __typename: 'Product',
              id: '1',
              price: '25.50 EUR',
            },
          });

          await relay.refetch();

          // Access again - should get new value
          const thirdAccess = result.product.price;
          expect(thirdAccess.amount).toBe(25.5);
          expect(thirdAccess.currency).toBe('EUR');
          expect(thirdAccess).not.toBe(firstAccess); // Should be a new object
        });
      });
    });

    describe('multiple formatted fields updates', () => {
      it('should update all formatted fields when entity is refetched', async () => {
        const User = entity(() => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
          createdAt: t.format('date-time'),
          birthDate: t.format('date'),
        }));

        mockFetch.get('/user/[id]', {
          user: {
            __typename: 'User',
            id: '1',
            name: 'Alice',
            createdAt: '2024-01-15T10:30:00.000Z',
            birthDate: '1990-05-20',
          },
        });

        await testWithClient(client, async () => {
          const getUser = query(() => ({
            path: '/user/[id]',
            response: { user: User },
          }));

          const relay = getUser({ id: '1' });
          const result1 = await relay;

          // Access both formatted fields
          const initialCreatedAt = result1.user.createdAt;
          const initialBirthDate = result1.user.birthDate;

          // Update the entity with new dates
          mockFetch.get('/user/[id]', {
            user: {
              __typename: 'User',
              id: '1',
              name: 'Alice',
              createdAt: '2024-06-10T14:20:00.000Z',
              birthDate: '1995-12-25',
            },
          });

          const result2 = await relay.refetch();

          // Both fields should be updated
          const updatedCreatedAt = result2.user.createdAt;
          const updatedBirthDate = result2.user.birthDate;

          expect(updatedCreatedAt.toISOString()).toBe('2024-06-10T14:20:00.000Z');
          expect(updatedCreatedAt).not.toBe(initialCreatedAt);

          // Verify both fields are stored with updated raw string values
          const userKey = hashValue('User:1');
          const entityData = getDocument(kv, userKey) as Record<string, unknown>;
          expect(entityData.birthDate).toBe('1995-12-25');
          expect(entityData.createdAt).toBe('2024-06-10T14:20:00.000Z');
        });
      });
    });
  });

  describe('Store Serialization and Restoration', () => {
    it('should serialize formatted values as raw strings/numbers in store', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
        createdAt: t.format('date-time'),
        birthDate: t.format('date'),
      }));

      const isoString = '2024-01-15T10:30:00.000Z';
      const dateString = '1990-05-20';
      mockFetch.get('/user/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          name: 'Alice',
          createdAt: isoString,
          birthDate: dateString,
        },
      });

      await testWithClient(client, async () => {
        const getUser = query(() => ({
          path: '/user/[id]',
          response: { user: User },
        }));

        const relay = getUser({ id: '1' });
        await relay;

        // Access the formatted fields to trigger parsing
        const _createdAt = relay.value!.user.createdAt;
        const _birthDate = relay.value!.user.birthDate;

        // Verify entity is persisted with raw string values (not parsed Date objects)
        const userKey = hashValue('User:1');
        const entityData = getDocument(kv, userKey) as Record<string, unknown>;

        expect(entityData).toBeDefined();
        expect(entityData.createdAt).toBe(isoString); // Should be raw string, not Date
        expect(entityData.birthDate).toBe(dateString); // Should be raw string, not Date
        expect(typeof entityData.createdAt).toBe('string');
        expect(typeof entityData.birthDate).toBe('string');
      });
    });

    it('should restore and parse formatted values when loading from store', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        createdAt: t.format('date-time'),
      }));

      const isoString = '2024-01-15T10:30:00.000Z';
      const userKey = hashValue('User:1');

      // Pre-populate entity in store with raw string value
      const userData = {
        __typename: 'User',
        id: '1',
        createdAt: isoString,
      };
      kv.setString(valueKeyFor(userKey), JSON.stringify(userData));

      mockFetch.get('/user/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          createdAt: isoString,
        },
      });

      await testWithClient(client, async () => {
        const getUser = query(() => ({
          path: '/user/[id]',
          response: { user: User },
        }));

        const relay = getUser({ id: '1' });
        const result = await relay;

        // Should restore correctly and parse lazily
        expect(result.user.createdAt).toBeInstanceOf(Date);
        expect(result.user.createdAt.toISOString()).toBe(isoString);
      });
    });

    it('should restore and parse custom formatted values when loading from store', async () => {
      registerFormat(
        'price',
        t.string,
        value => parseFloat(value.replace('$', '')),
        value => `$${value.toFixed(2)}`,
      );

      const Product = entity(() => ({
        __typename: t.typename('Product'),
        id: t.id,
        price: t.format('price'),
      }));

      const getProduct = query(() => ({
        path: '/product/[id]',
        response: { product: Product },
      }));

      const productKey = hashValue('Product:1');

      // Pre-populate entity in store with raw string value
      const productData = {
        __typename: 'Product',
        id: '1',
        price: '$10.99',
      };
      kv.setString(valueKeyFor(productKey), JSON.stringify(productData));

      // Set up query that references this entity
      const queryResult = {
        product: { __entityRef: productKey },
      };
      setQuery(kv, getProduct, { id: '1' }, queryResult, new Set([productKey]));

      mockFetch.get('/product/[id]', {
        product: {
          __typename: 'Product',
          id: '1',
          price: '$10.99',
        },
      });

      await testWithClient(client, async () => {
        const relay = getProduct({ id: '1' });
        const result = await relay;

        // Should restore correctly and parse lazily
        expect(result.product.price).toBe(10.99);
        expect(typeof result.product.price).toBe('number');
      });
    });
  });
});
