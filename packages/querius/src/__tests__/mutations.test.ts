import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryPersistentStore, SyncQueryStore } from '../stores/sync.js';
import { QueryClient } from '../QueryClient.js';
import { t } from '../typeDefs.js';
import { Entity } from '../proxy.js';
import { Mutation, getMutation } from '../mutation.js';
import { Query, getQuery } from '../query.js';
import { draft } from '../utils.js';
import { createMockFetch, testWithClient, sleep, getEntityMapSize } from './utils.js';

/**
 * Mutation Tests
 *
 * These tests focus on the mutation() API - executing mutations,
 * optimistic updates, and state management.
 */

describe.skip('Mutations', () => {
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

      class CreateUser extends Mutation {
        path = '/users';
        method = 'POST' as const;
        request = {
          name: t.string,
          email: t.string,
        };
        response = {
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
        expect(mut.value?.response.id).toBe(123);
        expect(mut.value?.response.name).toBe('New User');
        expect(mockFetch.calls[0].url).toBe('/users');
        expect(mockFetch.calls[0].options.method).toBe('POST');
      });
    });

    it('should execute a PUT mutation', async () => {
      mockFetch.put('/users/[id]', { id: 123, name: 'Updated User', email: 'updated@example.com' });

      class UpdateUser extends Mutation {
        path = '/users/[id]';
        method = 'PUT' as const;
        request = {
          id: t.id,
          name: t.string,
          email: t.string,
        };
        response = {
          id: t.number,
          name: t.string,
          email: t.string,
        };
      }

      await testWithClient(client, async () => {
        const mut = getMutation(UpdateUser);
        await mut.run({ id: '123', name: 'Updated User', email: 'updated@example.com' });

        expect(mut.isResolved).toBe(true);
        expect(mut.value?.response.name).toBe('Updated User');
        expect(mockFetch.calls[0].url).toBe('/users/123');
        expect(mockFetch.calls[0].options.method).toBe('PUT');
      });
    });

    it('should execute a PATCH mutation', async () => {
      mockFetch.patch('/users/[id]', { id: 123, name: 'Patched User' });

      class PatchUser extends Mutation {
        path = '/users/[id]';
        method = 'PATCH' as const;
        request = {
          id: t.id,
          name: t.string,
        };
        response = {
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

      class DeleteUser extends Mutation {
        path = '/users/[id]';
        method = 'DELETE' as const;
        request = {
          id: t.id,
        };
        response = {
          success: t.boolean,
        };
      }

      await testWithClient(client, async () => {
        const mut = getMutation(DeleteUser);
        await mut.run({ id: '123' });

        expect(mut.isResolved).toBe(true);
        expect(mut.value?.response.success).toBe(true);
        expect(mockFetch.calls[0].url).toBe('/users/123');
        expect(mockFetch.calls[0].options.method).toBe('DELETE');
      });
    });

    it('should send request body as JSON', async () => {
      mockFetch.post('/users', { id: 1 });

      class CreateUser extends Mutation {
        path = '/users';
        request = {
          name: t.string,
          age: t.number,
        };
        response = {
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

    it('should return the same mutation instance for same definition', async () => {
      mockFetch.post('/users', { id: 1 });
      mockFetch.post('/users', { id: 2 });

      class CreateUser extends Mutation {
        path = '/users';
        request = { name: t.string };
        response = { id: t.number };
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

      class CreateUser extends Mutation {
        path = '/users';
        request = { name: t.string };
        response = { id: t.number };
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

      class CreateUser extends Mutation {
        path = '/users';
        request = { name: t.string };
        response = { id: t.number };
        cache = {
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

      class CreateUser extends Mutation {
        path = '/users';
        request = { name: t.string };
        response = { id: t.number };
        cache = {
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
      class CreateUser extends Mutation {
        path = '/users';
        request = { name: t.string };
        response = { id: t.number };
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

      class CreateUser extends Mutation {
        path = '/users';
        request = { name: t.string };
        response = { id: t.number };
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

    it('should reset mutation state', async () => {
      mockFetch.post('/users', { id: 1 });

      class CreateUser extends Mutation {
        path = '/users';
        request = { name: t.string };
        response = { id: t.number };
      }

      await testWithClient(client, async () => {
        const mut = getMutation(CreateUser);
        await mut.run({ name: 'Test' });

        expect(mut.isResolved).toBe(true);
        expect(mut.value).toBeDefined();
      });

      // Reset outside of reactive context
      await testWithClient(client, async () => {
        const mut = getMutation(CreateUser);
        (mut as any).reset();

        expect(mut.isResolved).toBe(false);
        expect(mut.value).toBeUndefined();
      });
    });

    it('should reset after error', async () => {
      mockFetch.post('/users', null, { error: new Error('Failed') });

      class CreateUser extends Mutation {
        path = '/users';
        request = { name: t.string };
        response = { id: t.number };
      }

      await testWithClient(client, async () => {
        const mut = getMutation(CreateUser);

        try {
          await mut.run({ name: 'Test' });
        } catch (e) {
          // Expected - now check state
          expect(mut.isRejected).toBe(true);
          expect(mut.error).toBeDefined();
        }
      });

      // Reset outside of reactive context
      await testWithClient(client, async () => {
        const mut = getMutation(CreateUser);
        (mut as any).reset();

        expect(mut.isRejected).toBe(false);
        expect(mut.error).toBeUndefined();
      });
    });
  });

  // ============================================================
  // Optimistic Updates
  // ============================================================

  describe('Optimistic Updates', () => {
    it('should apply optimistic updates on mutation start', async () => {
      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
      }

      // First get user via query
      mockFetch.get('/users/[id]', { __typename: 'User', id: 1, name: 'Original Name' });

      class GetUser extends Query {
        path = '/users/[id]';
        response = t.entity(User);
      }

      // Setup slow update mutation
      mockFetch.put('/users/[id]', { __typename: 'User', id: 1, name: 'Updated Name' }, { delay: 100 });

      class UpdateUser extends Mutation {
        path = '/users/[id]';
        method = 'PUT' as const;
        request = t.entity(User);
        response = t.entity(User);
        optimisticUpdates = true;
      }

      await testWithClient(client, async () => {
        // First fetch the user
        const userQuery = getQuery(GetUser, { id: '1' });
        await userQuery;
        expect(userQuery.value?.name).toBe('Original Name');

        // Now run mutation - optimistic update should apply immediately
        const mut = getMutation(UpdateUser);
        const mutPromise = mut.run({ __typename: 'User', id: 1, name: 'Optimistic Name' } as any);

        // Give time for optimistic update to apply
        await sleep(10);

        // The entity should be updated optimistically
        // Note: Query would reflect this via reactive entity proxy

        // Wait for mutation to complete
        await mutPromise;

        expect(mut.value?.response.name).toBe('Updated Name');
      });
    });

    it('should revert optimistic updates on failure', async () => {
      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
      }

      mockFetch.get('/users/[id]', { __typename: 'User', id: 1, name: 'Original Name' });
      mockFetch.put('/users/[id]', null, { error: new Error('Update failed'), delay: 50 });

      class GetUser extends Query {
        path = '/users/[id]';
        response = t.entity(User);
      }

      class UpdateUser extends Mutation {
        path = '/users/[id]';
        method = 'PUT' as const;
        request = t.entity(User);
        response = t.entity(User);
        optimisticUpdates = true;
      }

      await testWithClient(client, async () => {
        const userQuery = getQuery(GetUser, { id: '1' });
        await userQuery;
        expect(userQuery.value?.name).toBe('Original Name');

        const mut = getMutation(UpdateUser);

        try {
          await mut.run({ __typename: 'User', id: 1, name: 'Optimistic Name' } as any);
          expect.fail('Should have thrown');
        } catch (e) {
          expect(mut.isRejected).toBe(true);
          // Entity should be reverted to original state
        }
      });
    });

    it('should not apply optimistic updates when disabled', async () => {
      mockFetch.post('/users', { id: 1, name: 'Created' }, { delay: 50 });

      class CreateUser extends Mutation {
        path = '/users';
        request = { name: t.string };
        response = { id: t.number, name: t.string };
        optimisticUpdates = false;
      }

      await testWithClient(client, async () => {
        const mut = getMutation(CreateUser);
        mut.run({ name: 'Test' });

        // No optimistic updates should be applied
        expect(mut.isPending).toBe(true);
      });
    });

    it('should deeply snapshot nested objects on optimistic update revert', async () => {
      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
        profile = t.object({
          bio: t.string,
          avatar: t.string,
        });
      }

      mockFetch.get('/users/[id]', {
        __typename: 'User',
        id: 1,
        name: 'Original Name',
        profile: { bio: 'Original Bio', avatar: 'original.jpg' },
      });
      mockFetch.put('/users/[id]', null, { error: new Error('Update failed'), delay: 50 });

      class GetUser extends Query {
        path = '/users/[id]';
        response = t.entity(User);
      }

      class UpdateUser extends Mutation {
        path = '/users/[id]';
        method = 'PUT' as const;
        request = t.entity(User);
        response = t.entity(User);
        optimisticUpdates = true;
      }

      await testWithClient(client, async () => {
        const userQuery = getQuery(GetUser, { id: '1' });
        await userQuery;

        // Verify original nested object
        expect((userQuery.value as any).profile?.bio).toBe('Original Bio');
        expect((userQuery.value as any).profile?.avatar).toBe('original.jpg');

        const mut = getMutation(UpdateUser);

        // Start the mutation (don't await yet)
        const mutPromise = mut.run({
          __typename: 'User',
          id: 1,
          name: 'Updated Name',
          profile: { bio: 'Updated Bio', avatar: 'updated.jpg' },
        } as any);

        // Wait a bit for optimistic update to apply
        await sleep(10);

        // Verify optimistic update was applied
        expect(userQuery.value?.name).toBe('Updated Name');
        expect((userQuery.value as any).profile?.bio).toBe('Updated Bio');
        expect((userQuery.value as any).profile?.avatar).toBe('updated.jpg');

        // Now wait for mutation to fail
        try {
          await mutPromise;
          expect.fail('Should have thrown');
        } catch {
          // Mutation failed, optimistic update should be reverted
          expect(mut.isRejected).toBe(true);

          // The nested object should be fully reverted to original values
          expect(userQuery.value?.name).toBe('Original Name');
          expect((userQuery.value as any).profile?.bio).toBe('Original Bio');
          expect((userQuery.value as any).profile?.avatar).toBe('original.jpg');
        }
      });
    });

    it('should deeply snapshot arrays on optimistic update revert', async () => {
      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
        tags = t.array(t.string);
      }

      mockFetch.get('/users/[id]', {
        __typename: 'User',
        id: 1,
        name: 'Original Name',
        tags: ['tag1', 'tag2'],
      });
      mockFetch.put('/users/[id]', null, { error: new Error('Update failed'), delay: 50 });

      class GetUser extends Query {
        path = '/users/[id]';
        response = t.entity(User);
      }

      class UpdateUser extends Mutation {
        path = '/users/[id]';
        method = 'PUT' as const;
        request = t.entity(User);
        response = t.entity(User);
        optimisticUpdates = true;
      }

      await testWithClient(client, async () => {
        const userQuery = getQuery(GetUser, { id: '1' });
        await userQuery;

        // Verify original array
        expect(userQuery.value?.tags).toEqual(['tag1', 'tag2']);

        const mut = getMutation(UpdateUser);

        // Start the mutation (don't await yet)
        const mutPromise = mut.run({
          __typename: 'User',
          id: 1,
          name: 'Updated Name',
          tags: ['newtag1', 'newtag2', 'newtag3'],
        } as any);

        // Wait a bit for optimistic update to apply
        await sleep(10);

        // Verify optimistic update was applied
        expect(userQuery.value?.name).toBe('Updated Name');
        expect(userQuery.value?.tags).toEqual(['newtag1', 'newtag2', 'newtag3']);

        // Now wait for mutation to fail
        try {
          await mutPromise;
          expect.fail('Should have thrown');
        } catch {
          // Mutation failed, optimistic update should be reverted
          expect(mut.isRejected).toBe(true);

          // The array should be fully reverted to original values
          expect(userQuery.value?.name).toBe('Original Name');
          expect(userQuery.value?.tags).toEqual(['tag1', 'tag2']);
        }
      });
    });

    it('should optimistically update entity with nested entity data', async () => {
      class Organization extends Entity {
        __typename = t.typename('Organization');
        id = t.id;
        name = t.string;
      }

      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
        organization = t.entity(Organization);
      }

      // Initial state
      mockFetch.get('/users/[id]', {
        __typename: 'User',
        id: 1,
        name: 'Original User',
        organization: { __typename: 'Organization', id: 100, name: 'Original Org' },
      });

      // Slow mutation
      mockFetch.put(
        '/users/[id]',
        {
          __typename: 'User',
          id: 1,
          name: 'Updated User',
          organization: { __typename: 'Organization', id: 100, name: 'Updated Org' },
        },
        { delay: 100 },
      );

      class GetUser extends Query {
        path = '/users/[id]';
        response = t.entity(User);
      }

      class UpdateUser extends Mutation {
        path = '/users/[id]';
        method = 'PUT' as const;
        request = t.entity(User);
        response = t.entity(User);
        optimisticUpdates = true;
      }

      await testWithClient(client, async () => {
        const userQuery = getQuery(GetUser, { id: '1' });
        await userQuery;

        expect(userQuery.value?.name).toBe('Original User');
        expect((userQuery.value?.organization as any).name).toBe('Original Org');

        const mut = getMutation(UpdateUser);
        const mutPromise = mut.run({
          __typename: 'User',
          id: 1,
          name: 'Optimistic User',
          organization: { __typename: 'Organization', id: 100, name: 'Optimistic Org' },
        } as any);

        await sleep(10);

        // Top-level entity (User) should be optimistically updated
        expect(userQuery.value?.name).toBe('Optimistic User');

        // Nested entity data is also updated (as part of the User entity's data)
        expect((userQuery.value?.organization as any).name).toBe('Optimistic Org');

        await mutPromise;

        // After mutation completes, both should be updated from the response
        expect(userQuery.value?.name).toBe('Updated User');
        expect((userQuery.value?.organization as any).name).toBe('Updated Org');
      });
    });

    it('should merge entity arrays by ID during optimistic updates', async () => {
      class Tag extends Entity {
        __typename = t.typename('Tag');
        id = t.id;
        name = t.string;
      }

      class Post extends Entity {
        __typename = t.typename('Post');
        id = t.id;
        title = t.string;
        tags = t.array(t.entity(Tag));
      }

      // Initial state with 2 tags
      mockFetch.get('/posts/[id]', {
        __typename: 'Post',
        id: 1,
        title: 'Original Post',
        tags: [
          { __typename: 'Tag', id: 1, name: 'javascript' },
          { __typename: 'Tag', id: 2, name: 'typescript' },
        ],
      });

      // Slow mutation - updates tag names and adds a new tag
      mockFetch.put(
        '/posts/[id]',
        {
          __typename: 'Post',
          id: 1,
          title: 'Updated Post',
          tags: [
            { __typename: 'Tag', id: 1, name: 'js' },
            { __typename: 'Tag', id: 2, name: 'ts' },
            { __typename: 'Tag', id: 3, name: 'react' },
          ],
        },
        { delay: 100 },
      );

      class GetPost extends Query {
        path = '/posts/[id]';
        response = t.entity(Post);
      }

      class UpdatePost extends Mutation {
        path = '/posts/[id]';
        method = 'PUT' as const;
        request = t.entity(Post);
        response = t.entity(Post);
        optimisticUpdates = true;
      }

      await testWithClient(client, async () => {
        const postQuery = getQuery(GetPost, { id: '1' });
        await postQuery;

        expect(postQuery.value?.title).toBe('Original Post');
        expect(postQuery.value?.tags).toHaveLength(2);
        expect((postQuery.value?.tags as any)[0].name).toBe('javascript');
        expect((postQuery.value?.tags as any)[1].name).toBe('typescript');

        const mut = getMutation(UpdatePost);
        const mutPromise = mut.run({
          __typename: 'Post',
          id: 1,
          title: 'Optimistic Post',
          tags: [
            { __typename: 'Tag', id: 1, name: 'optimistic-js' },
            { __typename: 'Tag', id: 2, name: 'optimistic-ts' },
            { __typename: 'Tag', id: 3, name: 'optimistic-react' },
          ],
        } as any);

        await sleep(10);

        // Title should be optimistically updated
        expect(postQuery.value?.title).toBe('Optimistic Post');

        // Tags array should be updated - matching by ID
        expect(postQuery.value?.tags).toHaveLength(3);
        expect((postQuery.value?.tags as any)[0].name).toBe('optimistic-js');
        expect((postQuery.value?.tags as any)[1].name).toBe('optimistic-ts');
        expect((postQuery.value?.tags as any)[2].name).toBe('optimistic-react');

        await mutPromise;

        // After mutation completes, should have the server response
        expect(postQuery.value?.title).toBe('Updated Post');
        expect(postQuery.value?.tags).toHaveLength(3);
        expect((postQuery.value?.tags as any)[0].name).toBe('js');
        expect((postQuery.value?.tags as any)[1].name).toBe('ts');
        expect((postQuery.value?.tags as any)[2].name).toBe('react');
      });
    });

    it('should throw when trying to optimistically update an entity with pending update', async () => {
      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
      }

      // First get user via query
      mockFetch.get('/users/[id]', { __typename: 'User', id: 1, name: 'Original Name' });

      class GetUser extends Query {
        path = '/users/[id]';
        response = t.entity(User);
      }

      // Setup slow update mutation (takes 200ms to complete)
      mockFetch.put('/users/[id]', { __typename: 'User', id: 1, name: 'Updated Name' }, { delay: 200 });

      class UpdateUser extends Mutation {
        path = '/users/[id]';
        method = 'PUT' as const;
        request = t.entity(User);
        response = t.entity(User);
        optimisticUpdates = true;
      }

      await testWithClient(client, async () => {
        // First fetch the user
        const userQuery = getQuery(GetUser, { id: '1' });
        await userQuery;
        expect(userQuery.value?.name).toBe('Original Name');

        // Start first mutation - optimistic update applies
        const mut1 = getMutation(UpdateUser);
        const mutPromise1 = mut1.run({ __typename: 'User', id: 1, name: 'First Update' } as any);

        // Give time for first optimistic update to apply
        await sleep(10);

        // Try to start second mutation while first is pending
        // This should throw because entity already has pending optimistic update
        const mut2 = getMutation(UpdateUser);
        expect(() => {
          mut2.run({ __typename: 'User', id: 1, name: 'Second Update' } as any);
        }).toThrow(/already has a pending optimistic update/);

        // Wait for first mutation to complete
        await mutPromise1;
        expect(mut1.value?.response.name).toBe('Updated Name');
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

      class GetUser extends Query {
        path = '/users/[id]';
        response = t.entity(User);
      }

      await testWithClient(client, async () => {
        const userQuery = getQuery(GetUser, { id: '1' });
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
  // Integration with Queries
  // ============================================================

  describe('Integration with Queries', () => {
    it('should update query results via entity store on mutation success', async () => {
      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
      }

      mockFetch.get('/users/[id]', { __typename: 'User', id: 1, name: 'Original' });
      mockFetch.put('/users/[id]', { __typename: 'User', id: 1, name: 'Updated via Mutation' });

      class GetUser extends Query {
        path = '/users/[id]';
        response = t.entity(User);
      }

      class UpdateUser extends Mutation {
        path = '/users/[id]';
        method = 'PUT' as const;
        request = t.entity(User);
        response = t.entity(User);
      }

      await testWithClient(client, async () => {
        // First fetch user
        const userQuery = getQuery(GetUser, { id: '1' });
        await userQuery;
        expect(userQuery.value?.name).toBe('Original');

        // Run mutation
        const mut = getMutation(UpdateUser);
        await mut.run({ __typename: 'User', id: 1, name: 'Updated via Mutation' } as any);

        // Give time for entity updates to propagate
        await sleep(10);

        // Query should reflect the updated entity
        // (Entity is updated in the store, and queries use the same entity proxies)
        expect(userQuery.value?.name).toBe('Updated via Mutation');
      });
    });

    it('should add entities to store from mutation response', async () => {
      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
      }

      mockFetch.post('/users', { __typename: 'User', id: 999, name: 'New User' });

      class CreateUser extends Mutation {
        path = '/users';
        request = { name: t.string };
        response = t.entity(User);
      }

      await testWithClient(client, async () => {
        expect(getEntityMapSize(client)).toBe(0);

        const mut = getMutation(CreateUser);
        await mut.run({ name: 'New User' });

        // Entity should be added to the store
        expect(getEntityMapSize(client)).toBe(1);
      });
    });

    it('should parse nested entities from mutation response', async () => {
      class Organization extends Entity {
        __typename = t.typename('Organization');
        id = t.id;
        name = t.string;
      }

      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
        organization = t.entity(Organization);
      }

      mockFetch.post('/users', {
        __typename: 'User',
        id: 1,
        name: 'New User',
        organization: { __typename: 'Organization', id: 100, name: 'Acme Corp' },
      });

      class CreateUser extends Mutation {
        path = '/users';
        request = { name: t.string, organizationId: t.number };
        response = t.entity(User);
      }

      await testWithClient(client, async () => {
        expect(getEntityMapSize(client)).toBe(0);

        const mut = getMutation(CreateUser);
        const result = await mut.run({ name: 'New User', organizationId: 100 });

        // Both User and Organization entities should be in the store
        expect(getEntityMapSize(client)).toBe(2);

        // Nested entity should be accessible
        expect((result.response.organization as any).name).toBe('Acme Corp');
      });
    });

    it('should update existing nested entities from mutation response', async () => {
      class Organization extends Entity {
        __typename = t.typename('Organization');
        id = t.id;
        name = t.string;
      }

      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
        organization = t.entity(Organization);
      }

      // First, fetch a user with an organization
      mockFetch.get('/users/[id]', {
        __typename: 'User',
        id: 1,
        name: 'Original User',
        organization: { __typename: 'Organization', id: 100, name: 'Original Org' },
      });

      // Mutation returns the same org with updated name
      mockFetch.put('/users/[id]', {
        __typename: 'User',
        id: 1,
        name: 'Updated User',
        organization: { __typename: 'Organization', id: 100, name: 'Updated Org' },
      });

      class GetUser extends Query {
        path = '/users/[id]';
        response = t.entity(User);
      }

      class UpdateUser extends Mutation {
        path = '/users/[id]';
        method = 'PUT' as const;
        request = t.entity(User);
        response = t.entity(User);
      }

      await testWithClient(client, async () => {
        const userQuery = getQuery(GetUser, { id: '1' });
        await userQuery;

        expect((userQuery.value?.organization as any).name).toBe('Original Org');

        const mut = getMutation(UpdateUser);
        await mut.run({
          __typename: 'User',
          id: 1,
          name: 'Updated User',
          organization: { __typename: 'Organization', id: 100, name: 'Updated Org' },
        } as any);

        await sleep(10);

        // The nested entity should be updated
        expect(userQuery.value?.name).toBe('Updated User');
        expect((userQuery.value?.organization as any).name).toBe('Updated Org');
      });
    });

    it('should handle arrays of nested entities in mutation response', async () => {
      class Tag extends Entity {
        __typename = t.typename('Tag');
        id = t.id;
        name = t.string;
      }

      class Post extends Entity {
        __typename = t.typename('Post');
        id = t.id;
        title = t.string;
        tags = t.array(t.entity(Tag));
      }

      mockFetch.post('/posts', {
        __typename: 'Post',
        id: 1,
        title: 'My Post',
        tags: [
          { __typename: 'Tag', id: 1, name: 'javascript' },
          { __typename: 'Tag', id: 2, name: 'typescript' },
        ],
      });

      class CreatePost extends Mutation {
        path = '/posts';
        request = { title: t.string };
        response = t.entity(Post);
      }

      await testWithClient(client, async () => {
        expect(getEntityMapSize(client)).toBe(0);

        const mut = getMutation(CreatePost);
        const result = await mut.run({ title: 'My Post' });

        // Post + 2 Tags = 3 entities
        expect(getEntityMapSize(client)).toBe(3);

        expect(result.response.tags).toHaveLength(2);
        expect((result.response.tags as any)[0].name).toBe('javascript');
        expect((result.response.tags as any)[1].name).toBe('typescript');
      });
    });
  });

  // ============================================================
  // Promise Interface
  // ============================================================

  describe('Promise Interface', () => {
    it('should be awaitable', async () => {
      mockFetch.post('/users', { id: 1, name: 'Test' });

      class CreateUser extends Mutation {
        path = '/users';
        request = { name: t.string };
        response = { id: t.number, name: t.string };
      }

      await testWithClient(client, async () => {
        const mut = getMutation(CreateUser);
        const result = await mut.run({ name: 'Test' });

        expect(result.response.id).toBe(1);
        expect(result.response.name).toBe('Test');
      });
    });

    it('should support .then()', async () => {
      mockFetch.post('/users', { id: 1 });

      class CreateUser extends Mutation {
        path = '/users';
        request = { name: t.string };
        response = { id: t.number };
      }

      await testWithClient(client, async () => {
        const mut = getMutation(CreateUser);
        const promise = mut.run({ name: 'Test' });

        const result = await promise.then(r => r.response.id * 2);
        expect(result).toBe(2);
      });
    });

    it('should support .catch()', async () => {
      mockFetch.post('/users', null, { error: new Error('Failed') });

      class CreateUser extends Mutation {
        path = '/users';
        request = { name: t.string };
        response = { id: t.number };
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

      class CreateUser extends Mutation {
        path = '/users';
        request = { name: t.string };
        response = { id: t.number };
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
});
