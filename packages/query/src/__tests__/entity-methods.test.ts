import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { context, getContext, withContexts, watchOnce, signal } from 'signalium';
import { MemoryPersistentStore, SyncQueryStore } from '../stores/sync.js';
import { QueryClient } from '../QueryClient.js';
import { entity, t } from '../typeDefs.js';
import { query } from '../query.js';
import type { ExtractType } from '../types.js';
import { createMockFetch, testWithClient } from './utils.js';

/**
 * Entity Methods Tests
 *
 * Tests entity methods defined via entity() and extend().
 * Methods are:
 * - Defined lazily via a factory function
 * - Typed with the correct `this` context (the reified entity type)
 * - Wrapped with reactiveMethod for automatic caching
 * - Inherited and merged when using extend()
 */

describe('Entity Methods', () => {
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

  describe('Basic Entity Methods', () => {
    it('should define methods on an entity', () => {
      const User = entity(
        () => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
          age: t.number,
        }),
        () => ({
          greet() {
            return `Hello, ${this.name}!`;
          },
          isAdult() {
            return this.age >= 18;
          },
        }),
      );

      // Verify the entity has a methods factory
      expect((User as any)._methodsFactory).toBeDefined();
      expect(typeof (User as any)._methodsFactory).toBe('function');

      // Verify calling the factory returns methods
      const methods = (User as any)._methodsFactory();
      expect(methods.greet).toBeDefined();
      expect(methods.isAdult).toBeDefined();
    });

    it('should call methods on entity proxies with correct this context', async () => {
      const User = entity(
        () => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
          age: t.number,
        }),
        () => ({
          greet() {
            return `Hello, ${this.name}!`;
          },
          isAdult() {
            return this.age >= 18;
          },
          getNameAndAge() {
            return `${this.name} is ${this.age} years old`;
          },
        }),
      );

      mockFetch.get('/users/[id]', {
        user: {
          __typename: 'User',
          id: 1,
          name: 'Alice',
          age: 30,
        },
      });

      await testWithClient(client, async () => {
        const getUser = query(() => ({
          path: '/users/[id]',
          response: { user: User },
        }));

        const relay = getUser({ id: '1' });
        const result = await relay;

        // Verify methods work and have correct this context
        expect(result.user.greet()).toBe('Hello, Alice!');
        expect(result.user.isAdult()).toBe(true);
        expect(result.user.getNameAndAge()).toBe('Alice is 30 years old');
      });
    });

    it('should support methods with parameters', async () => {
      const Calculator = entity(
        () => ({
          __typename: t.typename('Calculator'),
          id: t.id,
          baseValue: t.number,
        }),
        () => ({
          add(n: number) {
            return this.baseValue + n;
          },
          multiply(n: number) {
            return this.baseValue * n;
          },
          format(prefix: string, suffix: string) {
            return `${prefix}${this.baseValue}${suffix}`;
          },
        }),
      );

      mockFetch.get('/calc/[id]', {
        calc: {
          __typename: 'Calculator',
          id: 1,
          baseValue: 10,
        },
      });

      await testWithClient(client, async () => {
        const getCalc = query(() => ({
          path: '/calc/[id]',
          response: { calc: Calculator },
        }));

        const relay = getCalc({ id: '1' });
        const result = await relay;

        expect(result.calc.add(5)).toBe(15);
        expect(result.calc.multiply(3)).toBe(30);
        expect(result.calc.format('$', ' USD')).toBe('$10 USD');
      });
    });

    it('should support methods that return complex values', async () => {
      const User = entity(
        () => ({
          __typename: t.typename('User'),
          id: t.id,
          firstName: t.string,
          lastName: t.string,
          email: t.string,
        }),
        () => ({
          getFullName() {
            return { first: this.firstName, last: this.lastName };
          },
          toJSON() {
            return {
              id: this.id,
              name: `${this.firstName} ${this.lastName}`,
              email: this.email,
            };
          },
        }),
      );

      mockFetch.get('/users/[id]', {
        user: {
          __typename: 'User',
          id: 1,
          firstName: 'Alice',
          lastName: 'Smith',
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

        expect(result.user.getFullName()).toEqual({ first: 'Alice', last: 'Smith' });
        // Note: toJSON is special - the proxy has its own toJSON, so we test a different name
      });
    });
  });

  describe('Extended Entity Methods', () => {
    it('should add methods when extending an entity', () => {
      const BaseUser = entity(
        () => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
        }),
        () => ({
          greet() {
            return `Hello, ${this.name}!`;
          },
        }),
      );

      const ExtendedUser = BaseUser.extend(
        () => ({
          email: t.string,
          age: t.number,
        }),
        () => ({
          isAdult() {
            return this.age >= 18;
          },
          getEmail() {
            return this.email;
          },
        }),
      );

      // Verify extended entity has a methods factory
      expect((ExtendedUser as any)._methodsFactory).toBeDefined();

      // Verify the factory returns both parent and new methods
      const methods = (ExtendedUser as any)._methodsFactory();
      expect(methods.greet).toBeDefined(); // From parent
      expect(methods.isAdult).toBeDefined(); // From extension
      expect(methods.getEmail).toBeDefined(); // From extension
    });

    it('should call both parent and extended methods on entity proxies', async () => {
      const BaseUser = entity(
        () => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
        }),
        () => ({
          greet() {
            return `Hello, ${this.name}!`;
          },
        }),
      );

      const ExtendedUser = BaseUser.extend(
        () => ({
          email: t.string,
          age: t.number,
        }),
        () => ({
          isAdult() {
            return this.age >= 18;
          },
          getContactInfo() {
            return `${this.name} <${this.email}>`;
          },
        }),
      );

      mockFetch.get('/users/[id]', {
        user: {
          __typename: 'User',
          id: 1,
          name: 'Bob',
          email: 'bob@example.com',
          age: 25,
        },
      });

      await testWithClient(client, async () => {
        const getUser = query(() => ({
          path: '/users/[id]',
          response: { user: ExtendedUser },
        }));

        const relay = getUser({ id: '1' });
        const result = await relay;

        // Parent method
        expect(result.user.greet()).toBe('Hello, Bob!');

        // Extended methods
        expect(result.user.isAdult()).toBe(true);
        expect(result.user.getContactInfo()).toBe('Bob <bob@example.com>');
      });
    });

    it('should extend an entity without methods and add methods', async () => {
      const BaseUser = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      const ExtendedUser = BaseUser.extend(
        () => ({
          email: t.string,
        }),
        () => ({
          getEmail() {
            return this.email;
          },
          greet() {
            return `Hello, ${this.name}!`;
          },
        }),
      );

      mockFetch.get('/users/[id]', {
        user: {
          __typename: 'User',
          id: 1,
          name: 'Charlie',
          email: 'charlie@example.com',
        },
      });

      await testWithClient(client, async () => {
        const getUser = query(() => ({
          path: '/users/[id]',
          response: { user: ExtendedUser },
        }));

        const relay = getUser({ id: '1' });
        const result = await relay;

        expect(result.user.getEmail()).toBe('charlie@example.com');
        expect(result.user.greet()).toBe('Hello, Charlie!');
      });
    });

    it('should chain multiple extensions with methods', async () => {
      const BaseEntity = entity(
        () => ({
          __typename: t.typename('Entity'),
          id: t.id,
        }),
        () => ({
          getId() {
            return this.id;
          },
        }),
      );

      const NamedEntity = BaseEntity.extend(
        () => ({
          name: t.string,
        }),
        () => ({
          getName() {
            return this.name;
          },
        }),
      );

      const ContactEntity = NamedEntity.extend(
        () => ({
          email: t.string,
        }),
        () => ({
          getContact() {
            return `${this.name} <${this.email}>`;
          },
        }),
      );

      mockFetch.get('/entity/[id]', {
        entity: {
          __typename: 'Entity',
          id: '123',
          name: 'Test Entity',
          email: 'test@example.com',
        },
      });

      await testWithClient(client, async () => {
        const getEntity = query(() => ({
          path: '/entity/[id]',
          response: { entity: ContactEntity },
        }));

        const relay = getEntity({ id: '123' });
        const result = await relay;

        // All methods from the chain should be available
        expect(result.entity.getId()).toBe('123');
        expect(result.entity.getName()).toBe('Test Entity');
        expect(result.entity.getContact()).toBe('Test Entity <test@example.com>');
      });
    });

    it('should extend with fields only (no new methods) and preserve parent methods', async () => {
      const BaseUser = entity(
        () => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
        }),
        () => ({
          greet() {
            return `Hello, ${this.name}!`;
          },
        }),
      );

      // Extend with just fields, no new methods
      const ExtendedUser = BaseUser.extend(() => ({
        email: t.string,
        age: t.number,
      }));

      mockFetch.get('/users/[id]', {
        user: {
          __typename: 'User',
          id: 1,
          name: 'Dave',
          email: 'dave@example.com',
          age: 35,
        },
      });

      await testWithClient(client, async () => {
        const getUser = query(() => ({
          path: '/users/[id]',
          response: { user: ExtendedUser },
        }));

        const relay = getUser({ id: '1' });
        const result = await relay;

        // Parent method should still work
        expect(result.user.greet()).toBe('Hello, Dave!');

        // New fields should be accessible
        expect(result.user.email).toBe('dave@example.com');
        expect(result.user.age).toBe(35);
      });
    });
  });

  describe('Method Type Inference', () => {
    it('should include methods in ExtractType', () => {
      const User = entity(
        () => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
        }),
        () => ({
          greet() {
            return `Hello!`;
          },
        }),
      );

      // This is a compile-time test - if types are wrong, this won't compile
      type UserType = ExtractType<typeof User>;

      // Runtime verification that the type includes method
      const typeCheck: UserType = {
        __typename: 'User',
        id: '1',
        name: 'Test',
        greet: () => 'Hello!',
      };

      expect(typeCheck.greet()).toBe('Hello!');
    });

    it('should include extended methods in ExtractType', () => {
      const BaseUser = entity(
        () => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
        }),
        () => ({
          greet() {
            return 'Hello!';
          },
        }),
      );

      const ExtendedUser = BaseUser.extend(
        () => ({
          age: t.number,
        }),
        () => ({
          isAdult() {
            return true;
          },
        }),
      );

      type ExtendedUserType = ExtractType<typeof ExtendedUser>;

      // Runtime verification
      const typeCheck: ExtendedUserType = {
        __typename: 'User',
        id: '1',
        name: 'Test',
        age: 30,
        greet: () => 'Hello!',
        isAdult: () => true,
      };

      expect(typeCheck.greet()).toBe('Hello!');
      expect(typeCheck.isAdult()).toBe(true);
    });
  });

  describe('Entity Methods with Nested Entities', () => {
    it('should work with methods accessing nested entity properties', async () => {
      const Address = entity(() => ({
        __typename: t.typename('Address'),
        id: t.id,
        city: t.string,
        country: t.string,
      }));

      const User = entity(
        () => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
          address: Address,
        }),
        () => ({
          getLocation() {
            return `${this.address.city}, ${this.address.country}`;
          },
          greetWithLocation() {
            return `Hello, ${this.name} from ${this.address.city}!`;
          },
        }),
      );

      mockFetch.get('/users/[id]', {
        user: {
          __typename: 'User',
          id: 1,
          name: 'Eve',
          address: {
            __typename: 'Address',
            id: 100,
            city: 'New York',
            country: 'USA',
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

        expect(result.user.getLocation()).toBe('New York, USA');
        expect(result.user.greetWithLocation()).toBe('Hello, Eve from New York!');
      });
    });
  });

  describe('Entity Methods with Arrays', () => {
    it('should work with methods operating on array fields', async () => {
      const User = entity(
        () => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
          tags: t.array(t.string),
          scores: t.array(t.number),
        }),
        () => ({
          hasTag(tag: string) {
            return this.tags.includes(tag);
          },
          getAverageScore() {
            if (this.scores.length === 0) return 0;
            return this.scores.reduce((a, b) => a + b, 0) / this.scores.length;
          },
          getTagCount() {
            return this.tags.length;
          },
        }),
      );

      mockFetch.get('/users/[id]', {
        user: {
          __typename: 'User',
          id: 1,
          name: 'Frank',
          tags: ['developer', 'typescript', 'react'],
          scores: [85, 90, 95],
        },
      });

      await testWithClient(client, async () => {
        const getUser = query(() => ({
          path: '/users/[id]',
          response: { user: User },
        }));

        const relay = getUser({ id: '1' });
        const result = await relay;

        expect(result.user.hasTag('typescript')).toBe(true);
        expect(result.user.hasTag('python')).toBe(false);
        expect(result.user.getAverageScore()).toBe(90);
        expect(result.user.getTagCount()).toBe(3);
      });
    });
  });

  describe('Multiple Entities with Methods', () => {
    it('should handle multiple different entities with methods in same query', async () => {
      const Author = entity(
        () => ({
          __typename: t.typename('Author'),
          id: t.id,
          name: t.string,
        }),
        () => ({
          getDisplayName() {
            return `Author: ${this.name}`;
          },
        }),
      );

      const Book = entity(
        () => ({
          __typename: t.typename('Book'),
          id: t.id,
          title: t.string,
          author: Author,
        }),
        () => ({
          getFullTitle() {
            return `"${this.title}" by ${this.author.name}`;
          },
        }),
      );

      mockFetch.get('/books/[id]', {
        book: {
          __typename: 'Book',
          id: 1,
          title: 'The Great Gatsby',
          author: {
            __typename: 'Author',
            id: 10,
            name: 'F. Scott Fitzgerald',
          },
        },
      });

      await testWithClient(client, async () => {
        const getBook = query(() => ({
          path: '/books/[id]',
          response: { book: Book },
        }));

        const relay = getBook({ id: '1' });
        const result = await relay;

        expect(result.book.getFullTitle()).toBe('"The Great Gatsby" by F. Scott Fitzgerald');
        expect(result.book.author.getDisplayName()).toBe('Author: F. Scott Fitzgerald');
      });
    });
  });

  describe('Method Caching', () => {
    it('should cache method results - same call returns cached value', async () => {
      let computeCount = 0;

      const User = entity(
        () => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
          age: t.number,
        }),
        () => ({
          expensiveComputation() {
            computeCount++;
            return `Computed for ${this.name}`;
          },
        }),
      );

      mockFetch.get('/users/[id]', {
        user: {
          __typename: 'User',
          id: 1,
          name: 'Alice',
          age: 30,
        },
      });

      await testWithClient(client, async () => {
        const getUser = query(() => ({
          path: '/users/[id]',
          response: { user: User },
        }));

        const relay = getUser({ id: '1' });
        const result = await relay;

        // Call the method multiple times
        const result1 = result.user.expensiveComputation();
        const result2 = result.user.expensiveComputation();
        const result3 = result.user.expensiveComputation();

        // All results should be the same
        expect(result1).toBe('Computed for Alice');
        expect(result2).toBe('Computed for Alice');
        expect(result3).toBe('Computed for Alice');

        // The computation should only have run once (cached)
        expect(computeCount).toBe(1);
      });
    });

    it('should cache method results based on parameters', async () => {
      const computeCounts = new Map<string, number>();

      const Calculator = entity(
        () => ({
          __typename: t.typename('Calculator'),
          id: t.id,
          baseValue: t.number,
        }),
        () => ({
          multiply(factor: number) {
            const key = `multiply-${factor}`;
            computeCounts.set(key, (computeCounts.get(key) || 0) + 1);
            return this.baseValue * factor;
          },
          format(prefix: string, suffix: string) {
            const key = `format-${prefix}-${suffix}`;
            computeCounts.set(key, (computeCounts.get(key) || 0) + 1);
            return `${prefix}${this.baseValue}${suffix}`;
          },
        }),
      );

      mockFetch.get('/calc/[id]', {
        calc: {
          __typename: 'Calculator',
          id: 1,
          baseValue: 10,
        },
      });

      await testWithClient(client, async () => {
        const getCalc = query(() => ({
          path: '/calc/[id]',
          response: { calc: Calculator },
        }));

        const relay = getCalc({ id: '1' });
        const result = await relay;

        // Call multiply with same param multiple times - should be cached
        expect(result.calc.multiply(2)).toBe(20);
        expect(result.calc.multiply(2)).toBe(20);
        expect(result.calc.multiply(2)).toBe(20);
        expect(computeCounts.get('multiply-2')).toBe(1);

        // Call multiply with different param - separate cache entry
        expect(result.calc.multiply(3)).toBe(30);
        expect(result.calc.multiply(3)).toBe(30);
        expect(computeCounts.get('multiply-3')).toBe(1);

        // Original param still cached
        expect(result.calc.multiply(2)).toBe(20);
        expect(computeCounts.get('multiply-2')).toBe(1);

        // Multi-param method - same params cached
        expect(result.calc.format('$', ' USD')).toBe('$10 USD');
        expect(result.calc.format('$', ' USD')).toBe('$10 USD');
        expect(computeCounts.get('format-$- USD')).toBe(1);

        // Different params - separate cache
        expect(result.calc.format('€', ' EUR')).toBe('€10 EUR');
        expect(computeCounts.get('format-€- EUR')).toBe(1);
      });
    });

    it('should invalidate cache when reactive dependencies change', async () => {
      let computeCount = 0;
      const multiplierSignal = signal(2);

      const Calculator = entity(
        () => ({
          __typename: t.typename('Calculator'),
          id: t.id,
          baseValue: t.number,
        }),
        () => ({
          computeWithMultiplier() {
            computeCount++;
            return this.baseValue * multiplierSignal.value;
          },
        }),
      );

      mockFetch.get('/calc/[id]', {
        calc: {
          __typename: 'Calculator',
          id: 1,
          baseValue: 10,
        },
      });

      // First: Get the entity and call the method
      let calc: ReturnType<typeof getCalc> extends Promise<infer R> ? R : never;
      const getCalc = query(() => ({
        path: '/calc/[id]',
        response: { calc: Calculator },
      }));

      // Initial computation in first reactive scope
      await testWithClient(client, async () => {
        const relay = getCalc({ id: '1' });
        calc = await relay;

        // Initial computation
        expect(calc.calc.computeWithMultiplier()).toBe(20);
        expect(computeCount).toBe(1);

        // Cached result
        expect(calc.calc.computeWithMultiplier()).toBe(20);
        expect(computeCount).toBe(1);
      });

      // Change the signal outside the reactive scope
      multiplierSignal.value = 3;

      // Verify recomputation happens with new signal value in new reactive scope
      await testWithClient(client, async () => {
        const relay = getCalc({ id: '1' });
        calc = await relay;

        // Should recompute with new multiplier value
        expect(calc.calc.computeWithMultiplier()).toBe(30);
        expect(computeCount).toBe(2);

        // Should be cached again
        expect(calc.calc.computeWithMultiplier()).toBe(30);
        expect(computeCount).toBe(2);
      });
    });
  });

  describe('Context Accessibility in Methods', () => {
    it('should access context values in entity methods', async () => {
      const ThemeContext = context<'light' | 'dark'>('light');

      const User = entity(
        () => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
        }),
        () => ({
          getThemedGreeting() {
            const theme = getContext(ThemeContext);
            return theme === 'dark' ? `🌙 Hello, ${this.name}!` : `☀️ Hello, ${this.name}!`;
          },
        }),
      );

      const getUser = query(() => ({
        path: '/users/[id]',
        response: { user: User },
      }));

      // Set up context with dark theme - use testWithClient pattern plus additional context
      mockFetch.get('/users/[id]', {
        user: {
          __typename: 'User',
          id: 1,
          name: 'Alice',
        },
      });

      // Use testWithClient and wrap the context access
      await testWithClient(client, async () => {
        const relay = getUser({ id: '1' });
        const result = await relay;

        // Inside testWithClient, we need to call the method inside a context that has the theme
        const greeting = await withContexts([[ThemeContext, 'dark']], () =>
          watchOnce(() => result.user.getThemedGreeting()),
        );

        expect(greeting).toBe('🌙 Hello, Alice!');
      });

      // Test with light theme
      mockFetch.get('/users/[id]', {
        user: {
          __typename: 'User',
          id: 2,
          name: 'Alice',
        },
      });

      await testWithClient(client, async () => {
        const relay = getUser({ id: '2' });
        const result = await relay;

        const greeting = await withContexts([[ThemeContext, 'light']], () =>
          watchOnce(() => result.user.getThemedGreeting()),
        );

        expect(greeting).toBe('☀️ Hello, Alice!');
      });
    });

    it('should access multiple contexts in entity methods', async () => {
      const LocaleContext = context<string>('en');
      const CurrencyContext = context<string>('USD');

      const Product = entity(
        () => ({
          __typename: t.typename('Product'),
          id: t.id,
          name: t.string,
          price: t.number,
        }),
        () => ({
          getLocalizedPrice() {
            const locale = getContext(LocaleContext);
            const currency = getContext(CurrencyContext);
            return new Intl.NumberFormat(locale, {
              style: 'currency',
              currency,
            }).format(this.price);
          },
          getLocalizedName() {
            const locale = getContext(LocaleContext);
            // Simple localization simulation
            return locale === 'de' ? `Produkt: ${this.name}` : `Product: ${this.name}`;
          },
        }),
      );

      const getProduct = query(() => ({
        path: '/products/[id]',
        response: { product: Product },
      }));

      // Test with US locale and USD - use id '1'
      mockFetch.get('/products/[id]', {
        product: {
          __typename: 'Product',
          id: 1,
          name: 'Widget',
          price: 19.99,
        },
      });

      await testWithClient(client, async () => {
        const relay = getProduct({ id: '1' });
        const result = await relay;

        // Call method with US locale context
        const price = await withContexts(
          [
            [LocaleContext, 'en-US'],
            [CurrencyContext, 'USD'],
          ],
          () => watchOnce(() => result.product.getLocalizedPrice()),
        );
        const name = await withContexts([[LocaleContext, 'en-US']], () =>
          watchOnce(() => result.product.getLocalizedName()),
        );

        expect(price).toBe('$19.99');
        expect(name).toBe('Product: Widget');
      });

      // Test with German locale and EUR - use id '2' to get a fresh entity with its own cache
      mockFetch.get('/products/[id]', {
        product: {
          __typename: 'Product',
          id: 2,
          name: 'Widget',
          price: 19.99,
        },
      });

      await testWithClient(client, async () => {
        const relay = getProduct({ id: '2' });
        const result = await relay;

        // Call method with German locale context
        const price = await withContexts(
          [
            [LocaleContext, 'de'],
            [CurrencyContext, 'EUR'],
          ],
          () => watchOnce(() => result.product.getLocalizedPrice()),
        );
        const name = await withContexts([[LocaleContext, 'de']], () =>
          watchOnce(() => result.product.getLocalizedName()),
        );

        // EUR formatting in German locale
        expect(price).toMatch(/19,99\s*€/);
        expect(name).toBe('Produkt: Widget');
      });
    });

    it('should use context for conditional logic in methods', async () => {
      const UserRoleContext = context<'admin' | 'user' | 'guest'>('guest');

      const Document = entity(
        () => ({
          __typename: t.typename('Document'),
          id: t.id,
          title: t.string,
          content: t.string,
          secretNotes: t.string,
        }),
        () => ({
          getVisibleContent() {
            const role = getContext(UserRoleContext);
            if (role === 'admin') {
              return `${this.content}\n\n[Admin Notes: ${this.secretNotes}]`;
            }
            return this.content;
          },
          canEdit() {
            const role = getContext(UserRoleContext);
            return role === 'admin' || role === 'user';
          },
          canDelete() {
            const role = getContext(UserRoleContext);
            return role === 'admin';
          },
        }),
      );

      const getDoc = query(() => ({
        path: '/docs/[id]',
        response: { doc: Document },
      }));

      // Test as admin - use id '1'
      mockFetch.get('/docs/[id]', {
        doc: {
          __typename: 'Document',
          id: 1,
          title: 'Important Doc',
          content: 'Public content here',
          secretNotes: 'Secret admin notes',
        },
      });

      await testWithClient(client, async () => {
        const relay = getDoc({ id: '1' });
        const result = await relay;

        const content = await withContexts([[UserRoleContext, 'admin']], () =>
          watchOnce(() => result.doc.getVisibleContent()),
        );
        const canEdit = await withContexts([[UserRoleContext, 'admin']], () => watchOnce(() => result.doc.canEdit()));
        const canDelete = await withContexts([[UserRoleContext, 'admin']], () =>
          watchOnce(() => result.doc.canDelete()),
        );

        expect(content).toBe('Public content here\n\n[Admin Notes: Secret admin notes]');
        expect(canEdit).toBe(true);
        expect(canDelete).toBe(true);
      });

      // Test as regular user - use id '2' for fresh entity cache
      mockFetch.get('/docs/[id]', {
        doc: {
          __typename: 'Document',
          id: 2,
          title: 'Important Doc',
          content: 'Public content here',
          secretNotes: 'Secret admin notes',
        },
      });

      await testWithClient(client, async () => {
        const relay = getDoc({ id: '2' });
        const result = await relay;

        const content = await withContexts([[UserRoleContext, 'user']], () =>
          watchOnce(() => result.doc.getVisibleContent()),
        );
        const canEdit = await withContexts([[UserRoleContext, 'user']], () => watchOnce(() => result.doc.canEdit()));
        const canDelete = await withContexts([[UserRoleContext, 'user']], () =>
          watchOnce(() => result.doc.canDelete()),
        );

        expect(content).toBe('Public content here');
        expect(canEdit).toBe(true);
        expect(canDelete).toBe(false);
      });

      // Test as guest - use id '3' for fresh entity cache
      mockFetch.get('/docs/[id]', {
        doc: {
          __typename: 'Document',
          id: 3,
          title: 'Important Doc',
          content: 'Public content here',
          secretNotes: 'Secret admin notes',
        },
      });

      await testWithClient(client, async () => {
        const relay = getDoc({ id: '3' });
        const result = await relay;

        const content = await withContexts([[UserRoleContext, 'guest']], () =>
          watchOnce(() => result.doc.getVisibleContent()),
        );
        const canEdit = await withContexts([[UserRoleContext, 'guest']], () => watchOnce(() => result.doc.canEdit()));
        const canDelete = await withContexts([[UserRoleContext, 'guest']], () =>
          watchOnce(() => result.doc.canDelete()),
        );

        expect(content).toBe('Public content here');
        expect(canEdit).toBe(false);
        expect(canDelete).toBe(false);
      });
    });
  });

  describe('Methods Calling Other Methods', () => {
    it('should allow methods to call other methods on the same definition', async () => {
      const User = entity(
        () => ({
          __typename: t.typename('User'),
          id: t.id,
          firstName: t.string,
          lastName: t.string,
          age: t.number,
        }),
        () => ({
          getFullName() {
            return `${this.firstName} ${this.lastName}`;
          },
          getInitials() {
            return `${this.firstName[0]}${this.lastName[0]}`;
          },
          greet() {
            return `Hello, ${this.getFullName()}!`;
          },
          getFormattedAge() {
            return `${this.getFullName()} is ${this.age} years old`;
          },
          getDisplayInfo() {
            return `${this.greet()} (${this.getInitials()})`;
          },
        }),
      );

      mockFetch.get('/users/[id]', {
        user: {
          __typename: 'User',
          id: 1,
          firstName: 'Alice',
          lastName: 'Smith',
          age: 30,
        },
      });

      await testWithClient(client, async () => {
        const getUser = query(() => ({
          path: '/users/[id]',
          response: { user: User },
        }));

        const relay = getUser({ id: '1' });
        const result = await relay;

        // Test direct method calls
        expect(result.user.getFullName()).toBe('Alice Smith');
        expect(result.user.getInitials()).toBe('AS');

        // Test method calling another method
        expect(result.user.greet()).toBe('Hello, Alice Smith!');
        expect(result.user.getFormattedAge()).toBe('Alice Smith is 30 years old');

        // Test method calling multiple other methods
        expect(result.user.getDisplayInfo()).toBe('Hello, Alice Smith! (AS)');
      });
    });

    it('should allow methods to call other methods with parameters', async () => {
      const Calculator = entity(
        () => ({
          __typename: t.typename('Calculator'),
          id: t.id,
          baseValue: t.number,
        }),
        () => ({
          add(n: number) {
            return this.baseValue + n;
          },
          multiply(n: number) {
            return this.baseValue * n;
          },
          addThenMultiply(addend: number, multiplier: number) {
            // Add the addend, then multiply the result by the multiplier
            const sum = this.add(addend);
            return sum * multiplier;
          },
          multiplyThenAdd(multiplier: number, addend: number) {
            // Multiply baseValue by multiplier, then add the addend
            return this.add(this.multiply(multiplier));
          },
          complexOperation(x: number, y: number, z: number) {
            // Add x, multiply by y, then add z
            const sum = this.add(x);
            const product = this.multiply(y);
            return sum + product + z;
          },
        }),
      );

      mockFetch.get('/calc/[id]', {
        calc: {
          __typename: 'Calculator',
          id: 1,
          baseValue: 10,
        },
      });

      await testWithClient(client, async () => {
        const getCalc = query(() => ({
          path: '/calc/[id]',
          response: { calc: Calculator },
        }));

        const relay = getCalc({ id: '1' });
        const result = await relay;

        // Test basic methods
        expect(result.calc.add(5)).toBe(15);
        expect(result.calc.multiply(3)).toBe(30);

        // Test method calling another method with parameters
        // addThenMultiply(5, 3) = add(5) * 3 = 15 * 3 = 45
        expect(result.calc.addThenMultiply(5, 3)).toBe(45);

        // multiplyThenAdd(3, 5) = add(multiply(3)) = add(30) = 40
        expect(result.calc.multiplyThenAdd(3, 5)).toBe(40);

        // complexOperation(2, 4, 1) = add(2) + multiply(4) + 1 = 12 + 40 + 1 = 53
        expect(result.calc.complexOperation(2, 4, 1)).toBe(53);
      });
    });

    it('should allow methods in extended definitions to call parent methods', async () => {
      const BaseUser = entity(
        () => ({
          __typename: t.typename('User'),
          id: t.id,
          firstName: t.string,
          lastName: t.string,
        }),
        () => ({
          getFullName() {
            return `${this.firstName} ${this.lastName}`;
          },
          greet() {
            return `Hello, ${this.getFullName()}!`;
          },
        }),
      );

      const ExtendedUser = BaseUser.extend(
        () => ({
          email: t.string,
          age: t.number,
        }),
        () => ({
          isAdult() {
            return this.age >= 18;
          },
          getContactInfo() {
            // Call parent method
            return `${this.getFullName()} <${this.email}>`;
          },
          getGreetingWithAge() {
            // Call parent method
            return `${this.greet()} You are ${this.age} years old.`;
          },
          getFullInfo() {
            // Call both parent and new methods
            return `${this.getContactInfo()} - ${this.isAdult() ? 'Adult' : 'Minor'}`;
          },
        }),
      );

      mockFetch.get('/users/[id]', {
        user: {
          __typename: 'User',
          id: 1,
          firstName: 'Bob',
          lastName: 'Johnson',
          email: 'bob@example.com',
          age: 25,
        },
      });

      await testWithClient(client, async () => {
        const getUser = query(() => ({
          path: '/users/[id]',
          response: { user: ExtendedUser },
        }));

        const relay = getUser({ id: '1' });
        const result = await relay;

        // Test parent methods still work
        expect(result.user.getFullName()).toBe('Bob Johnson');
        expect(result.user.greet()).toBe('Hello, Bob Johnson!');

        // Test new methods
        expect(result.user.isAdult()).toBe(true);

        // Test new method calling parent method
        expect(result.user.getContactInfo()).toBe('Bob Johnson <bob@example.com>');
        expect(result.user.getGreetingWithAge()).toBe('Hello, Bob Johnson! You are 25 years old.');

        // Test new method calling both parent and new methods
        expect(result.user.getFullInfo()).toBe('Bob Johnson <bob@example.com> - Adult');
      });
    });

    it('should allow methods in extended definitions to call other new methods', async () => {
      const BaseUser = entity(
        () => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
        }),
        () => ({
          greet() {
            return `Hello, ${this.name}!`;
          },
        }),
      );

      const ExtendedUser = BaseUser.extend(
        () => ({
          email: t.string,
          age: t.number,
        }),
        () => ({
          isAdult() {
            return this.age >= 18;
          },
          getAgeCategory() {
            if (this.isAdult()) {
              return 'adult';
            }
            return 'minor';
          },
          getEmailDomain() {
            return this.email.split('@')[1];
          },
          getEmailInfo() {
            return `${this.email} (domain: ${this.getEmailDomain()})`;
          },
          getFullProfile() {
            // Call parent method, new method, and another new method
            return `${this.greet()} Age: ${this.age} (${this.getAgeCategory()}). ${this.getEmailInfo()}`;
          },
        }),
      );

      mockFetch.get('/users/[id]', {
        user: {
          __typename: 'User',
          id: 1,
          name: 'Charlie',
          email: 'charlie@example.com',
          age: 17,
        },
      });

      await testWithClient(client, async () => {
        const getUser = query(() => ({
          path: '/users/[id]',
          response: { user: ExtendedUser },
        }));

        const relay = getUser({ id: '1' });
        const result = await relay;

        // Test individual new methods
        expect(result.user.isAdult()).toBe(false);
        expect(result.user.getAgeCategory()).toBe('minor');
        expect(result.user.getEmailDomain()).toBe('example.com');
        expect(result.user.getEmailInfo()).toBe('charlie@example.com (domain: example.com)');

        // Test new method calling another new method
        expect(result.user.getFullProfile()).toBe(
          'Hello, Charlie! Age: 17 (minor). charlie@example.com (domain: example.com)',
        );
      });
    });

    it('should allow methods to call both parent and new methods in extended definitions', async () => {
      const BaseUser = entity(
        () => ({
          __typename: t.typename('User'),
          id: t.id,
          firstName: t.string,
          lastName: t.string,
        }),
        () => ({
          getFullName() {
            return `${this.firstName} ${this.lastName}`;
          },
          getInitials() {
            return `${this.firstName[0]}${this.lastName[0]}`;
          },
        }),
      );

      const ExtendedUser = BaseUser.extend(
        () => ({
          email: t.string,
          age: t.number,
        }),
        () => ({
          isAdult() {
            return this.age >= 18;
          },
          getEmailDomain() {
            return this.email.split('@')[1];
          },
          // Method that calls parent methods
          getDisplayName() {
            return `${this.getFullName()} (${this.getInitials()})`;
          },
          // Method that calls new methods
          getAgeStatus() {
            return `${this.isAdult() ? 'Adult' : 'Minor'} - ${this.getEmailDomain()}`;
          },
          // Method that calls both parent and new methods
          getCompleteProfile() {
            return `${this.getDisplayName()} - ${this.getAgeStatus()}`;
          },
        }),
      );

      mockFetch.get('/users/[id]', {
        user: {
          __typename: 'User',
          id: 1,
          firstName: 'David',
          lastName: 'Williams',
          email: 'david@company.com',
          age: 28,
        },
      });

      await testWithClient(client, async () => {
        const getUser = query(() => ({
          path: '/users/[id]',
          response: { user: ExtendedUser },
        }));

        const relay = getUser({ id: '1' });
        const result = await relay;

        // Test parent methods
        expect(result.user.getFullName()).toBe('David Williams');
        expect(result.user.getInitials()).toBe('DW');

        // Test new methods
        expect(result.user.isAdult()).toBe(true);
        expect(result.user.getEmailDomain()).toBe('company.com');

        // Test method calling parent methods
        expect(result.user.getDisplayName()).toBe('David Williams (DW)');

        // Test method calling new methods
        expect(result.user.getAgeStatus()).toBe('Adult - company.com');

        // Test method calling both parent and new methods
        expect(result.user.getCompleteProfile()).toBe('David Williams (DW) - Adult - company.com');
      });
    });

    it('should handle chained method calls across multiple extensions', async () => {
      const BaseEntity = entity(
        () => ({
          __typename: t.typename('Entity'),
          id: t.id,
        }),
        () => ({
          getId() {
            return this.id;
          },
        }),
      );

      const NamedEntity = BaseEntity.extend(
        () => ({
          name: t.string,
        }),
        () => ({
          getName() {
            return this.name;
          },
          getIdAndName() {
            // Call parent method
            return `${this.getId()}: ${this.getName()}`;
          },
        }),
      );

      const ContactEntity = NamedEntity.extend(
        () => ({
          email: t.string,
        }),
        () => ({
          getEmail() {
            return this.email;
          },
          getContact() {
            // Call grandparent and parent methods
            return `${this.getIdAndName()} <${this.getEmail()}>`;
          },
          getFullContact() {
            // Call new method which calls parent methods
            return this.getContact();
          },
        }),
      );

      mockFetch.get('/entity/[id]', {
        entity: {
          __typename: 'Entity',
          id: '123',
          name: 'Test Entity',
          email: 'test@example.com',
        },
      });

      await testWithClient(client, async () => {
        const getEntity = query(() => ({
          path: '/entity/[id]',
          response: { entity: ContactEntity },
        }));

        const relay = getEntity({ id: '123' });
        const result = await relay;

        // Test all methods are available
        expect(result.entity.getId()).toBe('123');
        expect(result.entity.getName()).toBe('Test Entity');
        expect(result.entity.getEmail()).toBe('test@example.com');

        // Test method calling parent method
        expect(result.entity.getIdAndName()).toBe('123: Test Entity');

        // Test method calling grandparent and parent methods
        expect(result.entity.getContact()).toBe('123: Test Entity <test@example.com>');

        // Test method calling another method that calls parent methods
        expect(result.entity.getFullContact()).toBe('123: Test Entity <test@example.com>');
      });
    });

    it('should properly cache method results when methods call other methods', async () => {
      let fullNameCallCount = 0;
      let initialsCallCount = 0;
      let greetCallCount = 0;

      const User = entity(
        () => ({
          __typename: t.typename('User'),
          id: t.id,
          firstName: t.string,
          lastName: t.string,
        }),
        () => ({
          getFullName() {
            fullNameCallCount++;
            return `${this.firstName} ${this.lastName}`;
          },
          getInitials() {
            initialsCallCount++;
            return `${this.firstName[0]}${this.lastName[0]}`;
          },
          greet() {
            greetCallCount++;
            // This calls getFullName, which should be cached
            return `Hello, ${this.getFullName()}!`;
          },
        }),
      );

      mockFetch.get('/users/[id]', {
        user: {
          __typename: 'User',
          id: 1,
          firstName: 'Eve',
          lastName: 'Brown',
        },
      });

      await testWithClient(client, async () => {
        const getUser = query(() => ({
          path: '/users/[id]',
          response: { user: User },
        }));

        const relay = getUser({ id: '1' });
        const result = await relay;

        // Call greet multiple times - it calls getFullName internally
        expect(result.user.greet()).toBe('Hello, Eve Brown!');
        expect(result.user.greet()).toBe('Hello, Eve Brown!');
        expect(result.user.greet()).toBe('Hello, Eve Brown!');

        // greet should only be called once (cached)
        expect(greetCallCount).toBe(1);

        // getFullName should only be called once per greet call (cached within greet)
        // Since greet is cached, getFullName should only be called once total
        expect(fullNameCallCount).toBe(1);

        // Call getFullName directly
        expect(result.user.getFullName()).toBe('Eve Brown');
        // Should use cached value, so count shouldn't increase
        expect(fullNameCallCount).toBe(1);
      });
    });
  });
});
