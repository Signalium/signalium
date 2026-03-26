import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryPersistentStore, SyncQueryStore } from '../stores/sync.js';
import { QueryClient } from '../QueryClient.js';
import { t } from '../typeDefs.js';
import { Entity } from '../proxy.js';
import { RESTMutation, getMutation } from '../mutation.js';
import { RESTQuery, fetchQuery } from '../query.js';
import { draft } from '../utils.js';
import { createMockFetch, testWithClient, sleep, getEntityMapSize } from './utils.js';

/**
 * Mutation Tests
 *
 * These tests focus on the mutation() API - executing mutations,
 * optimistic updates, and state management.
 */

describe('Mutations', () => {
  let client: QueryClient;
  let mockFetch: ReturnType<typeof createMockFetch>;

  beforeEach(() => {
    const store = new SyncQueryStore(new MemoryPersistentStore());
    mockFetch = createMockFetch();
    client = new QueryClient(store, { fetch: mockFetch as any });
  });

  afterEach(() => {
    client?.destroy();
  });

  // ============================================================
  // Basic Mutation Operations
  // ============================================================

  describe('Basic Mutation Operations', () => {
    it('should execute a POST mutation', async () => {
      mockFetch.post('/users', { id: 123, name: 'New User', email: 'new@example.com' });

      class CreateUser extends RESTMutation {
        readonly path = '/users';
        readonly method = 'POST' as const;
        readonly params = {
          name: t.string,
          email: t.string,
        };
        readonly body = { name: this.params.name, email: this.params.email };
        readonly result = {
          id: t.number,
          name: t.string,
          email: t.string,
        };
      }

      await testWithClient(client, async () => {
        const mut = getMutation(CreateUser);

        const result = mut.run({ name: 'New User', email: 'new@example.com' });
        expect(mut.isPending).toBe(true);

        await result;

        expect(mut.isResolved).toBe(true);
        expect(mut.value?.id).toBe(123);
        expect(mut.value?.name).toBe('New User');
        expect(mockFetch.calls[0].url).toBe('/users');
        expect(mockFetch.calls[0].options.method).toBe('POST');
      });
    });

    it('should execute a PUT mutation', async () => {
      mockFetch.put('/users/[id]', { id: 123, name: 'Updated User', email: 'updated@example.com' });

      class UpdateUser extends RESTMutation {
        readonly params = { id: t.id, name: t.string, email: t.string };
        readonly path = `/users/${this.params.id}`;
        readonly method = 'PUT' as const;
        readonly body = { name: this.params.name, email: this.params.email };
        readonly result = {
          id: t.number,
          name: t.string,
          email: t.string,
        };
      }

      await testWithClient(client, async () => {
        const mut = getMutation(UpdateUser);
        await mut.run({ id: '123', name: 'Updated User', email: 'updated@example.com' });

        expect(mut.isResolved).toBe(true);
        expect(mut.value?.name).toBe('Updated User');
        expect(mockFetch.calls[0].url).toBe('/users/123');
        expect(mockFetch.calls[0].options.method).toBe('PUT');
      });
    });

    it('should execute a PATCH mutation', async () => {
      mockFetch.patch('/users/[id]', { id: 123, name: 'Patched User' });

      class PatchUser extends RESTMutation {
        readonly params = { id: t.id, name: t.string };
        readonly path = `/users/${this.params.id}`;
        readonly method = 'PATCH' as const;
        readonly body = { name: this.params.name };
        readonly result = {
          id: t.number,
          name: t.string,
        };
      }

      await testWithClient(client, async () => {
        const mut = getMutation(PatchUser);
        await mut.run({ id: '123', name: 'Patched User' });

        expect(mut.isResolved).toBe(true);
        expect(mockFetch.calls[0].url).toBe('/users/123');
        expect(mockFetch.calls[0].options.method).toBe('PATCH');
      });
    });

    it('should execute a DELETE mutation', async () => {
      mockFetch.delete('/users/[id]', { success: true });

      class DeleteUser extends RESTMutation {
        readonly params = { id: t.id };
        readonly path = `/users/${this.params.id}`;
        readonly method = 'DELETE' as const;
        readonly result = {
          success: t.boolean,
        };
      }

      await testWithClient(client, async () => {
        const mut = getMutation(DeleteUser);
        await mut.run({ id: '123' });

        expect(mut.isResolved).toBe(true);
        expect(mut.value?.success).toBe(true);
        expect(mockFetch.calls[0].url).toBe('/users/123');
        expect(mockFetch.calls[0].options.method).toBe('DELETE');
      });
    });

    it('should send request body as JSON', async () => {
      mockFetch.post('/users', { id: 1 });

      class CreateUser extends RESTMutation {
        readonly path = '/users';
        readonly method = 'POST' as const;
        readonly params = { name: t.string, age: t.number };
        readonly body = { name: this.params.name, age: this.params.age };
        readonly result = {
          id: t.number,
        };
      }

      await testWithClient(client, async () => {
        const mut = getMutation(CreateUser);
        await mut.run({ name: 'Alice', age: 30 });

        const body = JSON.parse(mockFetch.calls[0].options.body as string);
        expect(body.name).toBe('Alice');
        expect(body.age).toBe(30);
      });
    });

    it('should support getBody() override for dynamic body computation', async () => {
      mockFetch.post('/users', { id: 1 });

      class CreateUser extends RESTMutation {
        readonly path = '/users';
        readonly method = 'POST' as const;
        readonly params = { name: t.string, role: t.string };
        readonly result = { id: t.number };

        getBody() {
          return {
            name: this.params.name,
            role: this.params.role,
            createdAt: 'now',
          };
        }
      }

      await testWithClient(client, async () => {
        const mut = getMutation(CreateUser);
        await mut.run({ name: 'Alice', role: 'admin' });

        const body = JSON.parse(mockFetch.calls[0].options.body as string);
        expect(body.name).toBe('Alice');
        expect(body.role).toBe('admin');
        expect(body.createdAt).toBe('now');
      });
    });

    it('should return the same mutation instance for same definition', async () => {
      mockFetch.post('/users', { id: 1 });
      mockFetch.post('/users', { id: 2 });

      class CreateUser extends RESTMutation {
        readonly path = '/users';
        readonly method = 'POST' as const;
        readonly params = { name: t.string };
        readonly body = { name: this.params.name };
        readonly result = { id: t.number };
      }

      await testWithClient(client, async () => {
        const mut1 = getMutation(CreateUser);
        const mut2 = getMutation(CreateUser);

        expect(mut1).toBe(mut2);
      });
    });
  });

  // ============================================================
  // Error Handling and Retry
  // ============================================================

  describe('Error Handling and Retry', () => {
    it('should handle network errors', async () => {
      const error = new Error('Network failed');
      mockFetch.post('/users', null, { error });

      class CreateUser extends RESTMutation {
        readonly path = '/users';
        readonly method = 'POST' as const;
        readonly params = { name: t.string };
        readonly body = { name: this.params.name };
        readonly result = { id: t.number };
      }

      await testWithClient(client, async () => {
        const mut = getMutation(CreateUser);

        try {
          await mut.run({ name: 'Test' });
          expect.fail('Should have thrown');
        } catch (e) {
          // Check state inside catch - state should already be set
          expect(mut.isRejected).toBe(true);
          expect(mut.error).toBe(error);
        }
      });
    });

    it('should retry on failure with configured retries', async () => {
      // First two calls fail, third succeeds
      let callCount = 0;
      mockFetch.post('/users', async () => {
        callCount++;
        if (callCount < 3) {
          throw new Error('Temporary failure');
        }
        return { id: 1 };
      });

      class CreateUser extends RESTMutation {
        readonly path = '/users';
        readonly method = 'POST' as const;
        readonly params = { name: t.string };
        readonly body = { name: this.params.name };
        readonly result = { id: t.number };
        config = {
          retry: {
            retries: 2,
            retryDelay: () => 10,
          },
        };
      }

      await testWithClient(client, async () => {
        const mut = getMutation(CreateUser);
        await mut.run({ name: 'Test' });

        expect(mut.isResolved).toBe(true);
        expect(callCount).toBe(3);
      });
    });

    it('should not retry when retry is false', async () => {
      mockFetch.post('/users', null, { error: new Error('Failed') });

      class CreateUser extends RESTMutation {
        readonly path = '/users';
        readonly method = 'POST' as const;
        readonly params = { name: t.string };
        readonly body = { name: this.params.name };
        readonly result = { id: t.number };
        config = {
          retry: false as const,
        };
      }

      await testWithClient(client, async () => {
        const mut = getMutation(CreateUser);

        try {
          await mut.run({ name: 'Test' });
          expect.fail('Should have thrown');
        } catch (e) {
          expect(mut.isRejected).toBe(true);
          expect(mockFetch.calls).toHaveLength(1);
        }
      });
    });
  });

  // ============================================================
  // State Management
  // ============================================================

  describe('State Management', () => {
    it('should have correct initial state before first run', async () => {
      class CreateUser extends RESTMutation {
        readonly path = '/users';
        readonly method = 'POST' as const;
        readonly params = { name: t.string };
        readonly body = { name: this.params.name };
        readonly result = { id: t.number };
      }

      await testWithClient(client, async () => {
        const mut = getMutation(CreateUser);

        expect(mut.isPending).toBe(false);
        expect(mut.isResolved).toBe(false);
        expect(mut.isRejected).toBe(false);
        expect(mut.value).toBeUndefined();
      });
    });

    it('should track pending state during mutation', async () => {
      mockFetch.post('/users', { id: 1 }, { delay: 50 });

      class CreateUser extends RESTMutation {
        readonly path = '/users';
        readonly method = 'POST' as const;
        readonly params = { name: t.string };
        readonly body = { name: this.params.name };
        readonly result = { id: t.number };
      }

      await testWithClient(client, async () => {
        const mut = getMutation(CreateUser);

        const promise = mut.run({ name: 'Test' });
        expect(mut.isPending).toBe(true);

        await promise;
        expect(mut.isPending).toBe(false);
        expect(mut.isResolved).toBe(true);
      });
    });
  });

  // ============================================================
  // Draft Entity Helper
  // ============================================================

  describe('Draft Entity Helper', () => {
    it('should create a mutable clone of an entity', async () => {
      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
        email = t.string;
      }

      mockFetch.get('/users/[id]', {
        __typename: 'User',
        id: 1,
        name: 'Original',
        email: 'original@test.com',
      });

      class GetUser extends RESTQuery {
        readonly params = { id: t.id };
        readonly path = `/users/${this.params.id}`;
        readonly result = t.entity(User);
      }

      await testWithClient(client, async () => {
        const userQuery = fetchQuery(GetUser, { id: '1' });
        await userQuery;

        const user = userQuery.value!;
        const userDraft = draft(user);

        // Draft should be mutable
        (userDraft as any).name = 'Modified';
        (userDraft as any).email = 'modified@test.com';

        expect(userDraft.name).toBe('Modified');
        expect(userDraft.email).toBe('modified@test.com');

        // Original should be unchanged
        expect(user.name).toBe('Original');
        expect(user.email).toBe('original@test.com');
      });
    });

    it('should deep clone nested objects', async () => {
      const original = {
        user: {
          name: 'Original',
          profile: {
            bio: 'Original bio',
          },
        },
        tags: ['tag1', 'tag2'],
      };

      const cloned = draft(original);

      cloned.user.name = 'Modified';
      cloned.user.profile.bio = 'Modified bio';
      cloned.tags.push('tag3');

      expect(cloned.user.name).toBe('Modified');
      expect(cloned.user.profile.bio).toBe('Modified bio');
      expect(cloned.tags).toHaveLength(3);

      // Original should be unchanged
      expect(original.user.name).toBe('Original');
      expect(original.user.profile.bio).toBe('Original bio');
      expect(original.tags).toHaveLength(2);
    });

    it('should handle primitives', () => {
      expect(draft(42)).toBe(42);
      expect(draft('hello')).toBe('hello');
      expect(draft(true)).toBe(true);
      expect(draft(null)).toBe(null);
      expect(draft(undefined)).toBe(undefined);
    });

    it('should clone Date objects', () => {
      const original = new Date('2024-01-01');
      const cloned = draft(original);

      expect(cloned).toBeInstanceOf(Date);
      expect(cloned.getTime()).toBe(original.getTime());
      expect(cloned).not.toBe(original);
    });
  });

  // ============================================================
  // Promise Interface
  // ============================================================

  describe('Promise Interface', () => {
    it('should be awaitable', async () => {
      mockFetch.post('/users', { id: 1, name: 'Test' });

      class CreateUser extends RESTMutation {
        readonly path = '/users';
        readonly method = 'POST' as const;
        readonly params = { name: t.string };
        readonly body = { name: this.params.name };
        readonly result = { id: t.number, name: t.string };
      }

      await testWithClient(client, async () => {
        const mut = getMutation(CreateUser);
        const result = await mut.run({ name: 'Test' });

        expect(result.id).toBe(1);
        expect(result.name).toBe('Test');
      });
    });

    it('should support .then()', async () => {
      mockFetch.post('/users', { id: 1 });

      class CreateUser extends RESTMutation {
        readonly path = '/users';
        readonly method = 'POST' as const;
        readonly params = { name: t.string };
        readonly body = { name: this.params.name };
        readonly result = { id: t.number };
      }

      await testWithClient(client, async () => {
        const mut = getMutation(CreateUser);
        const promise = mut.run({ name: 'Test' });

        const result = await promise.then(r => r.id * 2);
        expect(result).toBe(2);
      });
    });

    it('should support .catch()', async () => {
      mockFetch.post('/users', null, { error: new Error('Failed') });

      class CreateUser extends RESTMutation {
        readonly path = '/users';
        readonly method = 'POST' as const;
        readonly params = { name: t.string };
        readonly body = { name: this.params.name };
        readonly result = { id: t.number };
      }

      await testWithClient(client, async () => {
        const mut = getMutation(CreateUser);
        const promise = mut.run({ name: 'Test' });

        const result = await promise.catch(e => 'caught');
        expect(result).toBe('caught');
      });
    });

    it('should support .finally()', async () => {
      mockFetch.post('/users', { id: 1 });

      class CreateUser extends RESTMutation {
        readonly path = '/users';
        readonly method = 'POST' as const;
        readonly params = { name: t.string };
        readonly body = { name: this.params.name };
        readonly result = { id: t.number };
      }

      await testWithClient(client, async () => {
        const mut = getMutation(CreateUser);
        let finallyCalled = false;

        await mut.run({ name: 'Test' }).finally(() => {
          finallyCalled = true;
        });

        expect(finallyCalled).toBe(true);
      });
    });
  });

  // ============================================================
  // Response Payload Parsing
  // ============================================================

  describe('Response Payload Parsing', () => {
    it('should parse response with typed object shape', async () => {
      mockFetch.post('/items', { id: 42, name: 'Widget', active: true });

      class CreateItem extends RESTMutation {
        readonly path = '/items';
        readonly method = 'POST' as const;
        readonly params = { name: t.string };
        readonly body = { name: this.params.name };
        readonly result = { id: t.number, name: t.string, active: t.boolean };
      }

      await testWithClient(client, async () => {
        const mut = getMutation(CreateItem);
        await mut.run({ name: 'Widget' });

        expect(mut.value?.id).toBe(42);
        expect(mut.value?.name).toBe('Widget');
        expect(mut.value?.active).toBe(true);
      });
    });

    it('should reject response that fails type validation', async () => {
      mockFetch.post('/items', { id: 'not-a-number', name: 123 });

      class CreateItem extends RESTMutation {
        readonly path = '/items';
        readonly method = 'POST' as const;
        readonly params = { name: t.string };
        readonly body = { name: this.params.name };
        readonly result = { id: t.number, name: t.string };
      }

      await testWithClient(client, async () => {
        const mut = getMutation(CreateItem);

        try {
          await mut.run({ name: 'Test' });
          expect.fail('Should have thrown');
        } catch {
          expect(mut.isRejected).toBe(true);
        }
      });
    });
  });

  // ============================================================
  // Effects (params, response, getEffects)
  // ============================================================

  describe('Effects', () => {
    function defineEffectEntities() {
      class TodoItem extends Entity {
        __typename = t.typename('TodoItem');
        id = t.id;
        listId = t.string;
        name = t.string;
      }

      class TodoList extends Entity {
        __typename = t.typename('TodoList');
        id = t.id;
        items = t.liveArray(TodoItem, { constraints: { listId: this.id } });
      }

      class GetTodoList extends RESTQuery {
        readonly params = { id: t.id };
        readonly path = `/lists/${this.params.id}`;
        readonly result = { list: t.entity(TodoList) };
      }

      return { TodoItem, TodoList, GetTodoList };
    }

    it('should apply create effects using this.params', async () => {
      const { TodoItem, GetTodoList } = defineEffectEntities();

      mockFetch.get('/lists/[id]', {
        list: { __typename: 'TodoList', id: '1', items: [] },
      });
      mockFetch.post('/items', { ok: true });

      class CreateTodo extends RESTMutation {
        readonly params = { __typename: t.string, id: t.id, listId: t.string, name: t.string };
        readonly path = '/items';
        readonly method = 'POST' as const;
        readonly result = { ok: t.boolean };
        readonly effects = {
          creates: [[TodoItem, this.params] as const],
        };
      }

      await testWithClient(client, async () => {
        const listQuery = fetchQuery(GetTodoList, { id: '1' });
        await listQuery;
        expect(listQuery.value!.list.items).toHaveLength(0);

        const mut = getMutation(CreateTodo);
        await mut.run({ __typename: 'TodoItem', id: '99', listId: '1', name: 'Buy milk' });

        expect(listQuery.value!.list.items).toHaveLength(1);
        expect(listQuery.value!.list.items[0].name).toBe('Buy milk');
      });
    });

    it('should apply create effects using this.response', async () => {
      const { TodoItem, GetTodoList } = defineEffectEntities();

      mockFetch.get('/lists/[id]', {
        list: { __typename: 'TodoList', id: '1', items: [] },
      });
      mockFetch.post('/items', {
        item: { __typename: 'TodoItem', id: '99', listId: '1', name: 'From server' },
      });

      class CreateTodo extends RESTMutation {
        readonly params = { name: t.string, listId: t.string };
        readonly path = '/items';
        readonly method = 'POST' as const;
        readonly body = { name: this.params.name, listId: this.params.listId };
        readonly result = {
          item: t.object({
            __typename: t.string,
            id: t.id,
            listId: t.string,
            name: t.string,
          }),
        };
        readonly effects = {
          creates: [[TodoItem, this.result.item] as const],
        };
      }

      await testWithClient(client, async () => {
        const listQuery = fetchQuery(GetTodoList, { id: '1' });
        await listQuery;
        expect(listQuery.value!.list.items).toHaveLength(0);

        const mut = getMutation(CreateTodo);
        await mut.run({ name: 'From server', listId: '1' });

        expect(listQuery.value!.list.items).toHaveLength(1);
        expect(listQuery.value!.list.items[0].name).toBe('From server');
      });
    });

    it('should apply update effects using this.response', async () => {
      const { TodoItem, GetTodoList } = defineEffectEntities();

      mockFetch.get('/lists/[id]', {
        list: {
          __typename: 'TodoList',
          id: '1',
          items: [{ __typename: 'TodoItem', id: '1', listId: '1', name: 'Original' }],
        },
      });
      mockFetch.put('/items/[id]', {
        item: { __typename: 'TodoItem', id: '1', listId: '1', name: 'Updated' },
      });

      class UpdateTodo extends RESTMutation {
        readonly params = { id: t.id, name: t.string };
        readonly path = `/items/${this.params.id}`;
        readonly method = 'PUT' as const;
        readonly body = { name: this.params.name };
        readonly result = {
          item: t.object({
            __typename: t.string,
            id: t.id,
            listId: t.string,
            name: t.string,
          }),
        };
        readonly effects = {
          updates: [[TodoItem, this.result.item] as const],
        };
      }

      await testWithClient(client, async () => {
        const listQuery = fetchQuery(GetTodoList, { id: '1' });
        await listQuery;
        expect(listQuery.value!.list.items[0].name).toBe('Original');

        const mut = getMutation(UpdateTodo);
        await mut.run({ id: '1', name: 'Updated' });

        expect(listQuery.value!.list.items[0].name).toBe('Updated');
      });
    });

    it('should apply delete effects using this.params', async () => {
      const { TodoItem, GetTodoList } = defineEffectEntities();

      mockFetch.get('/lists/[id]', {
        list: {
          __typename: 'TodoList',
          id: '1',
          items: [{ __typename: 'TodoItem', id: '1', listId: '1', name: 'Doomed' }],
        },
      });
      mockFetch.delete('/items/[id]', { ok: true });

      class DeleteTodo extends RESTMutation {
        readonly params = { id: t.id };
        readonly path = `/items/${this.params.id}`;
        readonly method = 'DELETE' as const;
        readonly result = { ok: t.boolean };
        readonly effects = {
          deletes: [[TodoItem, this.params.id] as const],
        };
      }

      await testWithClient(client, async () => {
        const listQuery = fetchQuery(GetTodoList, { id: '1' });
        await listQuery;
        expect(listQuery.value!.list.items).toHaveLength(1);

        const mut = getMutation(DeleteTodo);
        await mut.run({ id: '1' });

        expect(listQuery.value!.list.items).toHaveLength(0);
      });
    });

    it('should apply effects via getEffects() using this.response', async () => {
      const { TodoItem, GetTodoList } = defineEffectEntities();

      mockFetch.get('/lists/[id]', {
        list: { __typename: 'TodoList', id: '1', items: [] },
      });
      mockFetch.post('/items', {
        item: { __typename: 'TodoItem', id: '77', listId: '1', name: 'Dynamic' },
      });

      class CreateTodoDynamic extends RESTMutation {
        readonly params = { name: t.string, listId: t.string };
        readonly path = '/items';
        readonly method = 'POST' as const;
        readonly body = { name: this.params.name, listId: this.params.listId };
        readonly result = {
          item: t.object({
            __typename: t.string,
            id: t.id,
            listId: t.string,
            name: t.string,
          }),
        };

        getEffects() {
          return {
            creates: [[TodoItem, this.result.item] as const],
          };
        }
      }

      await testWithClient(client, async () => {
        const listQuery = fetchQuery(GetTodoList, { id: '1' });
        await listQuery;
        expect(listQuery.value!.list.items).toHaveLength(0);

        const mut = getMutation(CreateTodoDynamic);
        await mut.run({ name: 'Dynamic', listId: '1' });

        expect(listQuery.value!.list.items).toHaveLength(1);
        expect(listQuery.value!.list.items[0].name).toBe('Dynamic');
      });
    });
  });

  // ============================================================
  // No-effects invariant
  // ============================================================

  describe('No-effects invariant', () => {
    it('should not modify entity store when mutation has no effects', async () => {
      mockFetch.post('/actions', { success: true, message: 'Done' });

      class RunAction extends RESTMutation {
        readonly path = '/actions';
        readonly method = 'POST' as const;
        readonly params = { action: t.string };
        readonly body = { action: this.params.action };
        readonly result = { success: t.boolean, message: t.string };
      }

      await testWithClient(client, async () => {
        expect(getEntityMapSize(client)).toBe(0);

        const mut = getMutation(RunAction);
        await mut.run({ action: 'cleanup' });

        expect(mut.value?.success).toBe(true);
        expect(mut.value?.message).toBe('Done');
        expect(getEntityMapSize(client)).toBe(0);
      });
    });
  });

  // ============================================================
  // this.response (raw HTTP Response) access in mutations
  // ============================================================

  describe('this.response in getEffects()', () => {
    it('should expose this.response with status and ok in getEffects()', async () => {
      mockFetch.post('/items', { id: '1', name: 'Created' });

      let capturedStatus: number | undefined;
      let capturedOk: boolean | undefined;

      class CreateItem extends RESTMutation {
        readonly params = { name: t.string };
        readonly path = '/items';
        readonly method = 'POST' as const;
        readonly body = { name: this.params.name };
        readonly result = { id: t.id, name: t.string };

        getEffects() {
          capturedStatus = this.response?.status;
          capturedOk = this.response?.ok;
          return undefined as any;
        }
      }

      await testWithClient(client, async () => {
        const mut = getMutation(CreateItem);
        await mut.run({ name: 'Created' });

        expect(capturedStatus).toBe(200);
        expect(capturedOk).toBe(true);
      });
    });

    it('should conditionally skip effects based on this.response.ok', async () => {
      mockFetch.post('/items', { error: 'conflict' }, { status: 409 });

      let effectsApplied = false;

      class CreateItem extends RESTMutation {
        readonly params = { name: t.string };
        readonly path = '/items';
        readonly method = 'POST' as const;
        readonly body = { name: this.params.name };
        readonly result = { error: t.optional(t.string) };

        getEffects() {
          if (!this.response?.ok) return undefined as any;
          effectsApplied = true;
          return { creates: [] };
        }
      }

      await testWithClient(client, async () => {
        const mut = getMutation(CreateItem);
        await mut.run({ name: 'Test' });

        expect(effectsApplied).toBe(false);
        expect(getEntityMapSize(client)).toBe(0);
      });
    });

    it('should expose this.response from non-200 success responses', async () => {
      mockFetch.post('/items', { id: '1' }, { status: 201 });

      let capturedStatus: number | undefined;

      class CreateItem extends RESTMutation {
        readonly params = { name: t.string };
        readonly path = '/items';
        readonly method = 'POST' as const;
        readonly body = { name: this.params.name };
        readonly result = { id: t.id };

        getEffects() {
          capturedStatus = this.response?.status;
          return undefined as any;
        }
      }

      await testWithClient(client, async () => {
        const mut = getMutation(CreateItem);
        await mut.run({ name: 'Test' });

        expect(capturedStatus).toBe(201);
      });
    });
  });
});
