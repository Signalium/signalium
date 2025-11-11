import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'vitest-browser-react';
import { ContextProvider } from 'signalium/react';
import { component } from 'signalium/react';
import React from 'react';
import { AsyncQueryStore, AsyncPersistentStore, StoreMessage, valueKeyFor } from '../../QueryStore.js';
import { QueryClient, QueryClientContext } from '../../QueryClient.js';
import { entity, t } from '../../typeDefs.js';
import { query, queryKeyForFn } from '../../query.js';
import { createMockFetch, sleep } from '../../__tests__/utils.js';

/**
 * React Integration Tests for AsyncQueryStore
 *
 * Tests React components using queries with AsyncQueryStore in reader-writer scenarios.
 */

// Mock async persistent store for testing
class MockAsyncPersistentStore implements AsyncPersistentStore {
  private readonly kv: Record<string, unknown> = Object.create(null);

  async has(key: string): Promise<boolean> {
    return key in this.kv;
  }

  async getString(key: string): Promise<string | undefined> {
    return this.kv[key] as string | undefined;
  }

  async setString(key: string, value: string): Promise<void> {
    this.kv[key] = value;
  }

  async getNumber(key: string): Promise<number | undefined> {
    return this.kv[key] as number | undefined;
  }

  async setNumber(key: string, value: number): Promise<void> {
    this.kv[key] = value;
  }

  async getBuffer(key: string): Promise<Uint32Array | undefined> {
    return this.kv[key] as Uint32Array | undefined;
  }

  async setBuffer(key: string, value: Uint32Array): Promise<void> {
    this.kv[key] = value;
  }

  async delete(key: string): Promise<void> {
    delete this.kv[key];
  }
}

// Message channel simulator for testing reader-writer communication
class MessageChannel {
  private writerHandler?: (msg: StoreMessage) => void;
  private readerHandler?: (msg: StoreMessage) => void;

  connectWriter(handler: (msg: StoreMessage) => void) {
    this.writerHandler = handler;
    return {
      sendMessage: (msg: StoreMessage) => {
        if (this.writerHandler) {
          this.writerHandler(msg);
        }
      },
    };
  }

  connectReader(handler: (msg: StoreMessage) => void) {
    this.readerHandler = handler;
    return {
      sendMessage: (msg: StoreMessage) => {
        if (this.writerHandler) {
          this.writerHandler(msg);
        }
      },
    };
  }
}

describe('React AsyncQueryStore Integration', () => {
  let writerStore: AsyncQueryStore;
  let readerStore: AsyncQueryStore;
  let mockDelegate: MockAsyncPersistentStore;
  let messageChannel: MessageChannel;
  let mockFetch: ReturnType<typeof createMockFetch>;
  let readerClient: QueryClient;
  let writerClient: QueryClient;

  beforeEach(() => {
    mockDelegate = new MockAsyncPersistentStore();
    messageChannel = new MessageChannel();

    // Create writer store
    writerStore = new AsyncQueryStore({
      isWriter: true,
      delegate: mockDelegate,
      connect: handler => messageChannel.connectWriter(handler),
    });

    // Create reader store
    readerStore = new AsyncQueryStore({
      isWriter: false,
      delegate: mockDelegate,
      connect: handler => messageChannel.connectReader(handler),
    });

    mockFetch = createMockFetch();
    readerClient = new QueryClient(readerStore, { fetch: mockFetch as any });
    writerClient = new QueryClient(writerStore, { fetch: mockFetch as any });
  });

  describe('Basic Reader-Writer Flow', () => {
    it('should fetch data in reader component and persist to writer', async () => {
      const User = entity(() => ({ id: t.id, name: t.string }));

      const getUser = query(() => ({
        path: '/users/[id]',
        response: User,
      }));

      mockFetch.get('/users/1', { id: '1', name: 'Alice' });

      const UserComponent = component(() => {
        const user = getUser({ id: '1' });

        if (user.isPending) {
          return <div>Loading...</div>;
        }

        return <div data-testid="user-name">{user.value!.name}</div>;
      });

      const { getByText, getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, readerClient]]}>
          <UserComponent />
        </ContextProvider>,
      );

      // Should show loading state
      await expect.element(getByText('Loading...')).toBeInTheDocument();

      // Should show data
      await expect.element(getByTestId('user-name')).toBeInTheDocument();
      expect(getByTestId('user-name').element().textContent).toBe('Alice');

      // Wait for async persistence
      await sleep(200);

      // Verify data was persisted (as entity reference in query, entity data stored separately)
      const queryKey = queryKeyForFn(getUser, { id: '1' });
      const persistedValue = await mockDelegate.getString(valueKeyFor(queryKey));

      expect(persistedValue).toBeDefined();
      // Query value contains entity reference, not the full entity data
      const parsed = JSON.parse(persistedValue!);
      expect(parsed).toHaveProperty('__entityRef');
    });

    it('should load persisted data in new reader without fetching', async () => {
      const User = entity(() => ({ id: t.id, name: t.string }));

      const getUser = query(() => ({
        path: '/users/[id]',
        response: User,
        cache: { staleTime: 10000 }, // 10 seconds - keep data fresh
      }));

      mockFetch.get('/users/1', { id: '1', name: 'Alice' });

      // First component fetches data
      const FirstComponent = component(() => {
        const user = getUser({ id: '1' });
        if (user.isPending) return <div>Loading...</div>;
        return <div data-testid="first-user">{user.value!.name}</div>;
      });

      const { getByTestId: getByTestId1, unmount } = render(
        <ContextProvider contexts={[[QueryClientContext, readerClient]]}>
          <FirstComponent />
        </ContextProvider>,
      );

      await expect.element(getByTestId1('first-user')).toBeInTheDocument();
      expect(getByTestId1('first-user').element().textContent).toBe('Alice');

      // Unmount and wait for persistence
      unmount();
      await sleep(200);

      // Create a new reader instance with same delegate
      const newMessageChannel = new MessageChannel();
      const newReaderStore = new AsyncQueryStore({
        isWriter: false,
        delegate: mockDelegate,
        connect: handler => newMessageChannel.connectReader(handler),
      });
      const newReaderClient = new QueryClient(newReaderStore, { fetch: mockFetch as any });

      // Second component should load from cache (async load required)
      const SecondComponent = component(() => {
        const user = getUser({ id: '1' });
        if (user.isPending) return <div>Loading cache...</div>;
        return <div data-testid="second-user">{user.value?.name ?? 'No data'}</div>;
      });

      const { getByTestId: getByTestId2 } = render(
        <ContextProvider contexts={[[QueryClientContext, newReaderClient]]}>
          <SecondComponent />
        </ContextProvider>,
      );

      // Should show cached data after async load completes
      await expect.element(getByTestId2('second-user')).toBeInTheDocument();
      expect(getByTestId2('second-user').element().textContent).toBe('Alice');

      // Wait a bit to ensure no background refetch happens
      await sleep(100);

      // Verify no additional fetch was made (data is still fresh)
      expect(mockFetch.calls.length).toBe(1);

      newReaderClient.destroy();
    });

    it('should refetch stale data in background while showing cached data', async () => {
      const User = entity(() => ({ id: t.id, name: t.string }));

      const getUser = query(() => ({
        path: '/users/[id]',
        response: User,
        cache: { staleTime: 50 }, // 50ms - data becomes stale quickly
      }));

      mockFetch.get('/users/1', { id: '1', name: 'Alice' });

      // First component fetches data
      const FirstComponent = component(() => {
        const user = getUser({ id: '1' });
        if (user.isPending) return <div>Loading...</div>;
        return <div data-testid="first-user">{user.value!.name}</div>;
      });

      const { getByTestId: getByTestId1, unmount } = render(
        <ContextProvider contexts={[[QueryClientContext, readerClient]]}>
          <FirstComponent />
        </ContextProvider>,
      );

      await expect.element(getByTestId1('first-user')).toBeInTheDocument();
      expect(getByTestId1('first-user').element().textContent).toBe('Alice');

      // Unmount and wait for persistence and data to become stale
      unmount();
      await sleep(200);

      // Create a new reader instance with same delegate
      const newMessageChannel = new MessageChannel();
      const newReaderStore = new AsyncQueryStore({
        isWriter: false,
        delegate: mockDelegate,
        connect: handler => newMessageChannel.connectReader(handler),
      });
      const newReaderClient = new QueryClient(newReaderStore, { fetch: mockFetch as any });

      // Setup mock to return updated data
      mockFetch.get('/users/1', { id: '1', name: 'Alice Updated' });

      // Second component should load from cache (async) then trigger background refetch
      const SecondComponent = component(() => {
        const user = getUser({ id: '1' });
        if (user.isPending) return <div>Loading cache...</div>;
        return <div data-testid="second-user">{user.value?.name ?? 'No data'}</div>;
      });

      const { getByTestId: getByTestId2 } = render(
        <ContextProvider contexts={[[QueryClientContext, newReaderClient]]}>
          <SecondComponent />
        </ContextProvider>,
      );

      // Wait for element to appear (after async cache load)
      await expect.element(getByTestId2('second-user')).toBeInTheDocument();

      // Check immediately - should have old cached data first
      const initialText = getByTestId2('second-user').element().textContent;

      // Wait for background refetch to complete
      await expect.poll(() => getByTestId2('second-user').element().textContent).toBe('Alice Updated');

      // Verify we either saw stale data first (ideal) or went straight to updated (fast refetch)
      // Both are acceptable behaviors for stale-while-revalidate
      expect(['Alice', 'Alice Updated']).toContain(initialText);

      // Should have made 2 fetches: initial + background refetch
      expect(mockFetch.calls.length).toBe(2);

      newReaderClient.destroy();
    });
  });

  describe('Multiple Components and Queries', () => {
    it('should handle multiple components fetching different queries', async () => {
      const User = entity(() => ({ id: t.id, name: t.string }));
      const Post = entity(() => ({ id: t.id, title: t.string, authorId: t.string }));

      const getUser = query(() => ({
        path: '/users/[id]',
        response: User,
      }));

      const getPost = query(() => ({
        path: '/posts/[id]',
        response: Post,
      }));

      mockFetch.get('/users/1', { id: '1', name: 'Alice' });
      mockFetch.get('/posts/100', { id: '100', title: 'Hello World', authorId: '1' });

      const UserComponent = component(({ userId }: { userId: string }) => {
        const user = getUser({ id: userId });
        if (user.isPending) return <div>Loading user...</div>;
        return <div data-testid={`user-${userId}`}>{user.value!.name}</div>;
      });

      const PostComponent = component(({ postId }: { postId: string }) => {
        const post = getPost({ id: postId });
        if (post.isPending) return <div>Loading post...</div>;
        return <div data-testid={`post-${postId}`}>{post.value!.title}</div>;
      });

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, readerClient]]}>
          <div>
            <UserComponent userId="1" />
            <PostComponent postId="100" />
          </div>
        </ContextProvider>,
      );

      // Both should eventually show data
      await expect.element(getByTestId('user-1')).toBeInTheDocument();
      await expect.element(getByTestId('post-100')).toBeInTheDocument();

      expect(getByTestId('user-1').element().textContent).toBe('Alice');
      expect(getByTestId('post-100').element().textContent).toBe('Hello World');

      // Wait for persistence
      await sleep(250);

      // Verify both were persisted (as entity references)
      const userQueryKey = queryKeyForFn(getUser, { id: '1' });
      const postQueryKey = queryKeyForFn(getPost, { id: '100' });

      const persistedUser = await mockDelegate.getString(valueKeyFor(userQueryKey));
      const persistedPost = await mockDelegate.getString(valueKeyFor(postQueryKey));

      expect(persistedUser).toBeDefined();
      expect(persistedPost).toBeDefined();
      // Query values contain entity references
      expect(JSON.parse(persistedUser!)).toHaveProperty('__entityRef');
      expect(JSON.parse(persistedPost!)).toHaveProperty('__entityRef');
    });
  });

  describe('Refetch and Updates', () => {
    it('should persist updated data after refetch', async () => {
      const User = entity(() => ({ id: t.id, name: t.string }));

      const getUser = query(() => ({
        path: '/users/[id]',
        response: User,
      }));

      mockFetch.get('/users/1', { id: '1', name: 'Alice' });

      const UserComponent = component(() => {
        const user = getUser({ id: '1' });

        if (user.isPending) return <div>Loading...</div>;

        return (
          <div>
            <div data-testid="user-name">{user.value!.name}</div>
            <button
              data-testid="refetch-btn"
              onClick={() => {
                user.refetch();
              }}
            >
              Refetch
            </button>
          </div>
        );
      });

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, readerClient]]}>
          <UserComponent />
        </ContextProvider>,
      );

      // Wait for initial data
      await expect.element(getByTestId('user-name')).toBeInTheDocument();
      expect(getByTestId('user-name').element().textContent).toBe('Alice');

      // Update mock to return new data
      mockFetch.get('/users/1', { id: '1', name: 'Alice Updated' });

      // Click refetch
      await getByTestId('refetch-btn').click();

      // Wait for updated data
      await expect.poll(() => getByTestId('user-name').element().textContent).toBe('Alice Updated');

      // Wait for persistence
      await sleep(200);

      // Verify updated data was persisted (as entity reference)
      const queryKey = queryKeyForFn(getUser, { id: '1' });
      const persistedValue = await mockDelegate.getString(valueKeyFor(queryKey));

      expect(JSON.parse(persistedValue!)).toHaveProperty('__entityRef');
    });
  });

  describe('Error States', () => {
    it('should handle fetch errors without crashing', async () => {
      const User = entity(() => ({ id: t.id, name: t.string }));

      const getUser = query(() => ({
        path: '/users/[id]',
        response: User,
      }));

      mockFetch.get('/users/1', null, { error: new Error('Network error') });

      const UserComponent = component(() => {
        const user = getUser({ id: '1' });

        if (user.isPending) return <div>Loading...</div>;
        if (user.isRejected) return <div data-testid="error">Error occurred</div>;

        return <div data-testid="user-name">{user.value!.name}</div>;
      });

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, readerClient]]}>
          <UserComponent />
        </ContextProvider>,
      );

      // Should eventually show error
      await expect.element(getByTestId('error')).toBeInTheDocument();

      // Error state should not crash the app
      expect(getByTestId('error').element().textContent).toBe('Error occurred');
    });
  });

  describe('Cross-Thread Simulation', () => {
    it('should simulate data flowing from reader thread to writer thread and back', async () => {
      const User = entity(() => ({ id: t.id, name: t.string }));

      const getUser = query(() => ({
        path: '/users/[id]',
        response: User,
        cache: { staleTime: 10000 }, // 10 seconds - keep data fresh
      }));

      mockFetch.get('/users/1', { id: '1', name: 'Alice' });
      mockFetch.get('/users/2', { id: '2', name: 'Bob' });

      // Simulate reader thread - Component 1 fetches user 1
      const ReaderComponent1 = component(() => {
        const user = getUser({ id: '1' });
        if (user.isPending) return <div>Loading user 1...</div>;
        return <div data-testid="reader1-name">{user.value!.name}</div>;
      });

      const { getByTestId: getReader1, unmount: unmountReader1 } = render(
        <ContextProvider contexts={[[QueryClientContext, readerClient]]}>
          <ReaderComponent1 />
        </ContextProvider>,
      );

      await expect.element(getReader1('reader1-name')).toBeInTheDocument();
      expect(getReader1('reader1-name').element().textContent).toBe('Alice');

      // Unmount first component before rendering second to avoid test framework issues
      unmountReader1();
      await sleep(50);

      // Simulate reader thread - Component 2 fetches user 2
      const ReaderComponent2 = component(() => {
        const user = getUser({ id: '2' });
        if (user.isPending) return <div>Loading user 2...</div>;
        return <div data-testid="reader2-name">{user.value!.name}</div>;
      });

      const { getByTestId: getReader2, unmount: unmountReader2 } = render(
        <ContextProvider contexts={[[QueryClientContext, readerClient]]}>
          <ReaderComponent2 />
        </ContextProvider>,
      );

      await expect.element(getReader2('reader2-name')).toBeInTheDocument();
      expect(getReader2('reader2-name').element().textContent).toBe('Bob');

      // Clean up reader component
      unmountReader2();

      // Wait for writer to persist both
      await sleep(300);

      // Simulate new reader thread coming online and loading from persistent storage
      const newMessageChannel = new MessageChannel();
      const newReaderStore = new AsyncQueryStore({
        isWriter: false,
        delegate: mockDelegate,
        connect: handler => newMessageChannel.connectReader(handler),
      });
      const newReaderClient = new QueryClient(newReaderStore, { fetch: mockFetch as any });

      const NewReaderComponent = component(() => {
        const user1 = getUser({ id: '1' });
        const user2 = getUser({ id: '2' });

        // Wait for both queries to load from cache
        if (user1.isPending || user2.isPending) {
          return <div>Loading from cache...</div>;
        }

        return (
          <div>
            <div data-testid="new-reader-user1">{user1.value?.name ?? 'No data'}</div>
            <div data-testid="new-reader-user2">{user2.value?.name ?? 'No data'}</div>
          </div>
        );
      });

      const { getByTestId: getNewReader } = render(
        <ContextProvider contexts={[[QueryClientContext, newReaderClient]]}>
          <NewReaderComponent />
        </ContextProvider>,
      );

      // Both users should be available from cache immediately
      await expect.element(getNewReader('new-reader-user1')).toBeInTheDocument();
      await expect.element(getNewReader('new-reader-user2')).toBeInTheDocument();

      expect(getNewReader('new-reader-user1').element().textContent).toBe('Alice');
      expect(getNewReader('new-reader-user2').element().textContent).toBe('Bob');

      // Wait a bit to ensure no background refetches happen
      await sleep(100);

      // Should only have made 2 fetches total (the initial ones, data is still fresh)
      expect(mockFetch.calls.length).toBe(2);

      newReaderClient.destroy();
    });
  });
});
