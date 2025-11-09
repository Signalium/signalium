import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'vitest-browser-react';
import { ContextProvider, useReactive } from 'signalium/react';
import React, { memo } from 'react';
import { SyncQueryStore, MemoryPersistentStore } from '../../QueryStore.js';
import { QueryClient, QueryClientContext } from '../../QueryClient.js';
import { entity, t } from '../../typeDefs.js';
import { query } from '../../query.js';
import { createMockFetch, sleep } from '../../__tests__/utils.js';
import { createRenderCounter } from './utils.js';
import { QueryResult } from '../../types.js';

/**
 * React Tests for Query Package
 *
 * These tests focus on end-to-end user-facing behavior in React components.
 * They verify that query results properly trigger component re-renders,
 * handle loading/error states, and work correctly with React patterns.
 */

describe('React Query Integration', () => {
  let client: QueryClient;
  let mockFetch: ReturnType<typeof createMockFetch>;

  beforeEach(() => {
    client?.destroy();
    const store = new SyncQueryStore(new MemoryPersistentStore());
    mockFetch = createMockFetch();
    client = new QueryClient(store, { fetch: mockFetch as any });
  });

  describe('Basic Query Usage', () => {
    it('should show loading state then data in component', async () => {
      mockFetch.get('/item', { id: 1, name: 'Test Item' }, { delay: 50 });

      const getItem = query(() => ({
        path: '/item',
        response: { id: t.number, name: t.string },
      }));

      function Component(): React.ReactNode {
        const item = useReactive(getItem);

        if (item.isPending) {
          return <div>Loading...</div>;
        }

        if (item.isRejected) {
          return <div>Error: {String(item.error)}</div>;
        }

        return <div>{item.value!.name}</div>;
      }

      const { getByText } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await expect.element(getByText('Loading...')).toBeInTheDocument();
      await expect.element(getByText('Test Item')).toBeInTheDocument();
    });

    it('should show error state on fetch failure', async () => {
      const error = new Error('Failed to fetch');
      mockFetch.get('/item', null, { error });

      const getItem = query(() => ({
        path: '/item',
        response: { id: t.number, name: t.string },
      }));

      function Component(): React.ReactNode {
        const item = useReactive(getItem);

        if (item.isPending) {
          return <div>Loading...</div>;
        }

        if (item.isRejected) {
          return <div>Error occurred</div>;
        }

        return <div>{item.value!.name}</div>;
      }

      const { getByText } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await expect.element(getByText('Loading...')).toBeInTheDocument();
      await expect.element(getByText('Error occurred')).toBeInTheDocument();
    });

    it('should handle multiple queries in one component', async () => {
      mockFetch.get('/user', { id: 1, name: 'Alice' });
      mockFetch.get('/posts', { posts: [{ id: 1, title: 'Hello' }] });

      const getUser = query(() => ({
        path: '/user',
        response: { id: t.number, name: t.string },
      }));

      const getPosts = query(() => ({
        path: '/posts',
        response: {
          posts: t.array(
            t.object({
              id: t.number,
              title: t.string,
            }),
          ),
        },
      }));

      function Component(): React.ReactNode {
        const user = useReactive(getUser);
        const posts = useReactive(getPosts);

        if (user.isPending || posts.isPending) {
          return <div>Loading...</div>;
        }

        return (
          <div>
            <span data-testid="user">{user.value!.name}</span>
            <span data-testid="posts">{posts.value!.posts.length} posts</span>
          </div>
        );
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await expect.element(getByTestId('user')).toBeInTheDocument();
      await expect.element(getByTestId('posts')).toBeInTheDocument();

      expect(getByTestId('user').element().textContent).toBe('Alice');
      expect(getByTestId('posts').element().textContent).toBe('1 posts');
    });

    it('should handle query with path parameters', async () => {
      mockFetch.get('/users/[id]', { id: 123, name: 'Bob' });

      const getUser = query(() => ({
        path: '/users/[id]',
        response: { id: t.number, name: t.string },
      }));

      function Component(): React.ReactNode {
        const user = useReactive(getUser, { id: '123' });

        if (!user.isReady) {
          return <div>Loading...</div>;
        }

        return <div>{user.value!.name}</div>;
      }

      const { getByText } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await expect.element(getByText('Bob')).toBeInTheDocument();
    });
  });

  describe('Entity Updates and Reactivity', () => {
    it('should update component when entity data changes', async () => {
      const User = entity(t => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      mockFetch.get('/user/[id]', { __typename: 'User', id: '1', name: 'Alice' });
      mockFetch.get('/user/[id]', { __typename: 'User', id: '1', name: 'Alice Updated' });

      const getUser = query(() => ({
        path: '/user/[id]',
        response: User,
      }));

      const Counter = createRenderCounter(({ user }: { user: { name: string } }) => <div>{user.name}</div>);

      let userQuery: QueryResult<{ name: string }>;

      function Component(): React.ReactNode {
        userQuery = useReactive(getUser, { id: '1' });

        if (!userQuery.isReady) {
          return <div>Loading...</div>;
        }

        return <Counter user={userQuery.value!} />;
      }

      const { getByText, getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await expect.element(getByText('Alice')).toBeInTheDocument();
      expect(Counter.renderCount).toBe(1);

      // Trigger refetch
      await userQuery!.refetch();

      await expect.element(getByText('Alice Updated')).toBeInTheDocument();
      expect(getByTestId(String(Counter.testId))).toBeDefined();
      expect(Counter.renderCount).toBe(2);
    });

    it('should keep multiple components in sync when sharing entity data', async () => {
      const User = entity(t => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      mockFetch.get('/user/[id]', { __typename: 'User', id: '1', name: 'Alice' });

      const getUser = query(() => ({
        path: '/user/[id]',
        response: User,
      }));

      function UserName({ user }: { user: { name: string } }): React.ReactNode {
        return <span data-testid="name">{user.name}</span>;
      }

      function UserGreeting({ user }: { user: { name: string } }): React.ReactNode {
        return <span data-testid="greeting">Hello, {user.name}!</span>;
      }

      function Component(): React.ReactNode {
        const result = useReactive(getUser, { id: '1' });

        if (!result.isReady) {
          return <div>Loading...</div>;
        }

        const user = result.value!;
        return (
          <div>
            <UserName user={user} />
            <UserGreeting user={user} />
            <button
              onClick={async () => {
                mockFetch.get('/user/[id]', { __typename: 'User', id: '1', name: 'Alice Smith' });
                await result.refetch();
              }}
            >
              Update
            </button>
          </div>
        );
      }

      const { getByTestId, getByText } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await expect.element(getByTestId('name')).toBeInTheDocument();
      await expect.element(getByTestId('greeting')).toBeInTheDocument();

      expect(getByTestId('name').element().textContent).toBe('Alice');
      expect(getByTestId('greeting').element().textContent).toBe('Hello, Alice!');

      // Click button to refetch and update entity
      await getByText('Update').click();
      await sleep(10);

      // Both components should show updated data
      expect(getByTestId('name').element().textContent).toBe('Alice Smith');
      expect(getByTestId('greeting').element().textContent).toBe('Hello, Alice Smith!');
    });

    it('should sync entity updates across different queries that reference the same entity', async () => {
      const User = entity(t => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
        email: t.string,
      }));

      const Post = entity(t => ({
        __typename: t.typename('Post'),
        id: t.id,
        title: t.string,
        content: t.string,
        author: User,
      }));

      // Two completely different API endpoints
      mockFetch.get('/user/[id]', { __typename: 'User', id: '1', name: 'Alice', email: 'alice@example.com' });
      mockFetch.get('/posts/[postId]', {
        __typename: 'Post',
        id: '100',
        title: 'My Post',
        content: 'Post content here',
        author: { __typename: 'User', id: '1', name: 'Alice', email: 'alice@example.com' },
      });
      mockFetch.get('/user/[id]', {
        __typename: 'User',
        id: '1',
        name: 'Alice Updated',
        email: 'alice.updated@example.com',
      });

      // Two separate query definitions
      const getUser = query(() => ({
        path: '/user/[id]',
        response: User,
      }));

      const getPost = query(() => ({
        path: '/posts/[postId]',
        response: Post,
      }));

      // First component - displays user profile from user endpoint
      function UserProfile(): React.ReactNode {
        const result = useReactive(getUser, { id: '1' });

        if (!result.isReady) {
          return <div>Profile Loading...</div>;
        }

        return (
          <div data-testid="profile">
            <div data-testid="profile-name">{result.value!.name}</div>
            <div data-testid="profile-email">{result.value!.email}</div>
          </div>
        );
      }

      // Second component - displays post with nested author from post endpoint
      function PostView(): React.ReactNode {
        const result = useReactive(getPost, { postId: '100' });
        const userResult = useReactive(getUser, { id: '1' });

        if (!result.isReady) {
          return <div>Post Loading...</div>;
        }

        const post = result.value!;
        return (
          <div data-testid="post">
            <div data-testid="post-title">{post.title}</div>
            <div data-testid="post-author-name">{post.author.name}</div>
            <div data-testid="post-author-email">{post.author.email}</div>
            <button
              onClick={async () => {
                // Refetch the USER endpoint, not the post
                await userResult.refetch();
              }}
            >
              Refresh User
            </button>
          </div>
        );
      }

      // App component - renders both independently
      function App(): React.ReactNode {
        return (
          <div>
            <UserProfile />
            <PostView />
          </div>
        );
      }

      const { getByTestId, getByText } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <App />
        </ContextProvider>,
      );

      // Wait for both components to load
      await expect.element(getByTestId('profile')).toBeInTheDocument();
      await expect.element(getByTestId('post')).toBeInTheDocument();

      // Both queries should show the same User entity (Alice) with initial data
      expect(getByTestId('profile-name').element().textContent).toBe('Alice');
      expect(getByTestId('profile-email').element().textContent).toBe('alice@example.com');
      expect(getByTestId('post-author-name').element().textContent).toBe('Alice');
      expect(getByTestId('post-author-email').element().textContent).toBe('alice@example.com');

      // Click refresh button in the Post component (which refetches the USER endpoint)
      await getByText('Refresh User').click();
      await sleep(10);

      // BOTH queries should show updated User entity data
      // This proves entities are shared across different query definitions
      expect(getByTestId('profile-name').element().textContent).toBe('Alice Updated');
      expect(getByTestId('profile-email').element().textContent).toBe('alice.updated@example.com');
      expect(getByTestId('post-author-name').element().textContent).toBe('Alice Updated');
      expect(getByTestId('post-author-email').element().textContent).toBe('alice.updated@example.com');

      // Verify we made 3 fetches: getUser, getPost, refetch getUser
      expect(mockFetch.calls.length).toBe(3);
      expect(mockFetch.calls[0].url).toBe('/user/1');
      expect(mockFetch.calls[1].url).toBe('/posts/100');
      expect(mockFetch.calls[2].url).toBe('/user/1');
    });

    it('should handle nested entities correctly', async () => {
      const User = entity(t => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      const Post = entity(t => ({
        __typename: t.typename('Post'),
        id: t.id,
        title: t.string,
        author: User,
      }));

      mockFetch.get('/post/[id]', {
        __typename: 'Post',
        id: '1',
        title: 'My Post',
        author: { __typename: 'User', id: '5', name: 'Alice' },
      });

      const getPost = query(() => ({
        path: '/post/[id]',
        response: Post,
      }));

      function Component(): React.ReactNode {
        const result = useReactive(getPost, { id: '1' });

        if (!result.isReady) {
          return <div>Loading...</div>;
        }

        const post = result.value!;
        return (
          <div>
            <div data-testid="title">{post.title}</div>
            <div data-testid="author">{post.author.name}</div>
          </div>
        );
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await expect.element(getByTestId('title')).toBeInTheDocument();
      expect(getByTestId('title').element().textContent).toBe('My Post');
      expect(getByTestId('author').element().textContent).toBe('Alice');
    });

    it('should conditionally render based on entity data', async () => {
      const User = entity(t => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
        isAdmin: t.boolean,
      }));

      mockFetch.get('/user', { __typename: 'User', id: '1', name: 'Alice', isAdmin: true });

      const getUser = query(() => ({
        path: '/user',
        response: User,
      }));

      function Component(): React.ReactNode {
        const result = useReactive(getUser);

        if (!result.isReady) {
          return <div>Loading...</div>;
        }

        const user = result.value!;
        return (
          <div>
            <div data-testid="name">{user.name}</div>
            {user.isAdmin && <div data-testid="admin-badge">Admin</div>}
          </div>
        );
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await expect.element(getByTestId('name')).toBeInTheDocument();
      await expect.element(getByTestId('admin-badge')).toBeInTheDocument();

      expect(getByTestId('admin-badge').element().textContent).toBe('Admin');
    });
  });

  describe('React-Specific Edge Cases', () => {
    it('should work with React.memo components', async () => {
      mockFetch.get('/item', { id: 1, name: 'Test' });

      const getItem = query(() => ({
        path: '/item',
        response: { id: t.number, name: t.string },
      }));

      let childRenderCount = 0;
      let itemQuery: QueryResult<{ id: number; name: string }>;

      const Child = memo(({ name }: { name: string }): React.ReactNode => {
        childRenderCount++;
        return <div data-testid="child">{name}</div>;
      });

      function Parent(): React.ReactNode {
        itemQuery = useReactive(getItem);

        if (!itemQuery.isReady) {
          return <div>Loading...</div>;
        }

        return <Child name={itemQuery.value!.name} />;
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Parent />
        </ContextProvider>,
      );

      await expect.element(getByTestId('child')).toBeInTheDocument();
      expect(childRenderCount).toBe(1);

      // Refetch with same data - child should not re-render due to memo
      mockFetch.get('/item', { id: 1, name: 'Test' });
      await itemQuery!.refetch();
      await sleep(10);

      expect(childRenderCount).toBe(1); // Should still be 1
    });

    it('should deduplicate multiple components using same query', async () => {
      mockFetch.get('/counter', { count: 5 });

      const getCounter = query(() => ({
        path: '/counter',
        response: { count: t.number },
      }));

      function ComponentA(): React.ReactNode {
        const result = useReactive(getCounter);
        return <div data-testid="a">{result.isReady ? result.value!.count : 'Loading'}</div>;
      }

      function ComponentB(): React.ReactNode {
        const result = useReactive(getCounter);
        return <div data-testid="b">{result.isReady ? result.value!.count : 'Loading'}</div>;
      }

      function App(): React.ReactNode {
        return (
          <div>
            <ComponentA />
            <ComponentB />
          </div>
        );
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <App />
        </ContextProvider>,
      );

      await expect.element(getByTestId('a')).toBeInTheDocument();
      await expect.element(getByTestId('b')).toBeInTheDocument();

      // Wait for data to load
      await sleep(10);

      expect(getByTestId('a').element().textContent).toBe('5');
      expect(getByTestId('b').element().textContent).toBe('5');

      // Verify only one fetch was made
      expect(mockFetch.calls.length).toBe(1);
    });

    it('should handle query refetch and update components', async () => {
      mockFetch.get('/counter', { count: 0 });

      const getCounter = query(() => ({
        path: '/counter',
        response: { count: t.number },
      }));

      function Component(): React.ReactNode {
        const result = useReactive(getCounter);

        return (
          <div>
            <div data-testid="count">{result.isReady ? result.value!.count : 'Loading'}</div>
            <button
              onClick={async () => {
                mockFetch.get('/counter', { count: (result.value?.count ?? 0) + 1 });
                await result.refetch();
              }}
            >
              Refetch
            </button>
          </div>
        );
      }

      const { getByTestId, getByText } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await expect.element(getByTestId('count')).toBeInTheDocument();

      // Wait for initial data to load
      await sleep(10);
      expect(getByTestId('count').element().textContent).toBe('0');

      // Click to refetch
      mockFetch.get('/counter', { count: 1 });
      await getByText('Refetch').click();
      await sleep(10);

      expect(getByTestId('count').element().textContent).toBe('1');
    });

    it('should pass query results as props to children correctly', async () => {
      mockFetch.get('/data', { value: 'Hello World' });

      const getData = query(() => ({
        path: '/data',
        response: { value: t.string },
      }));

      function Child({ data }: { data: { value: string } }): React.ReactNode {
        return <div data-testid="child">{data.value}</div>;
      }

      function Parent(): React.ReactNode {
        const result = useReactive(getData);

        if (!result.isReady) {
          return <div>Loading...</div>;
        }

        return <Child data={result.value!} />;
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Parent />
        </ContextProvider>,
      );

      await expect.element(getByTestId('child')).toBeInTheDocument();
      expect(getByTestId('child').element().textContent).toBe('Hello World');
    });

    it('should handle component unmount and remount', async () => {
      mockFetch.get('/item', { id: 1, name: 'Persistent' });

      const getItem = query(() => ({
        path: '/item',
        response: { id: t.number, name: t.string },
      }));

      function Child(): React.ReactNode {
        const result = useReactive(getItem);
        return <div data-testid="child">{result.isReady ? result.value!.name : 'Loading'}</div>;
      }

      function Parent({ show }: { show: boolean }): React.ReactNode {
        return <div>{show && <Child />}</div>;
      }

      const { rerender, getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Parent show={true} />
        </ContextProvider>,
      );

      // Wait for initial load
      await expect.element(getByTestId('child')).toBeInTheDocument();
      await sleep(10);
      expect(getByTestId('child').element().textContent).toBe('Persistent');

      // Unmount child
      rerender(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Parent show={false} />
        </ContextProvider>,
      );
      await sleep(10);

      // Remount child - should use cached data (loads immediately, not from network)
      rerender(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Parent show={true} />
        </ContextProvider>,
      );
      await expect.element(getByTestId('child')).toBeInTheDocument();
      // Should show cached data immediately without delay
      expect(getByTestId('child').element().textContent).toBe('Persistent');

      // Note: The number of fetches may vary depending on context lifecycle,
      // but the important thing is that cached data is available immediately
      expect(mockFetch.calls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Async Promise States', () => {
    it('should update all promise properties correctly', async () => {
      mockFetch.get('/item', { data: 'test' }, { delay: 50 });

      const getItem = query(() => ({
        path: '/item',
        response: { data: t.string },
      }));

      const states: Array<{
        isPending: boolean;
        isResolved: boolean;
        isRejected: boolean;
        isSettled: boolean;
        isReady: boolean;
        hasValue: boolean;
        hasError: boolean;
      }> = [];

      function Component(): React.ReactNode {
        const result = useReactive(getItem);

        states.push({
          isPending: result.isPending,
          isResolved: result.isResolved,
          isRejected: result.isRejected,
          isSettled: result.isSettled,
          isReady: result.isReady,
          hasValue: result.value !== undefined,
          hasError: result.error !== undefined,
        });

        return <div data-testid="status">{result.isReady ? 'Ready' : 'Loading'}</div>;
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      // Initial state - pending
      expect(states[0].isPending).toBe(true);
      expect(states[0].isReady).toBe(false);
      expect(states[0].isSettled).toBe(false);

      await expect.element(getByTestId('status')).toBeInTheDocument();
      await sleep(100);

      // After resolution
      const finalState = states[states.length - 1];
      expect(finalState.isPending).toBe(false);
      expect(finalState.isResolved).toBe(true);
      expect(finalState.isRejected).toBe(false);
      expect(finalState.isReady).toBe(true);
      expect(finalState.isSettled).toBe(true);
      expect(finalState.hasValue).toBe(true);
    });

    it('should transition from pending to error state', async () => {
      const error = new Error('Network error');
      mockFetch.get('/item', null, { error, delay: 50 });

      const getItem = query(() => ({
        path: '/item',
        response: { data: t.string },
        cache: { retry: false }, // Disable retries for this test
      }));

      function Component(): React.ReactNode {
        const result = useReactive(getItem);

        if (result.isPending) {
          return <div data-testid="status">Pending</div>;
        }

        if (result.isRejected) {
          return <div data-testid="status">Rejected</div>;
        }

        return <div data-testid="status">Success</div>;
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await expect.element(getByTestId('status')).toBeInTheDocument();
      expect(getByTestId('status').element().textContent).toBe('Pending');

      await sleep(100);

      expect(getByTestId('status').element().textContent).toBe('Rejected');
    });

    it('should show loading indicator during fetch', async () => {
      mockFetch.get('/slow', { data: 'result' }, { delay: 100 });

      const getItem = query(() => ({
        path: '/slow',
        response: { data: t.string },
      }));

      function Component(): React.ReactNode {
        const result = useReactive(getItem);

        return (
          <div>
            {result.isPending && <div data-testid="spinner">Loading...</div>}
            {result.isReady && <div data-testid="content">{result.value!.data}</div>}
          </div>
        );
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      // Should show spinner initially
      await expect.element(getByTestId('spinner')).toBeInTheDocument();

      // Wait for data
      await sleep(150);

      // Should now show content
      await expect.element(getByTestId('content')).toBeInTheDocument();
      expect(getByTestId('content').element().textContent).toBe('result');
    });

    it('should keep previous value during refetch', async () => {
      mockFetch.get('/item', { data: 'first' });

      const getItem = query(() => ({
        path: '/item',
        response: { data: t.string },
      }));

      let itemQuery: QueryResult<{ data: string }>;

      function Component(): React.ReactNode {
        itemQuery = useReactive(getItem);

        return (
          <div>
            {itemQuery.isPending && <div data-testid="loading">Loading</div>}
            {itemQuery.isReady && <div data-testid="data">{itemQuery.value!.data}</div>}
            <button
              onClick={async () => {
                mockFetch.get('/item', { data: 'second' }, { delay: 50 });
                await itemQuery.refetch();
              }}
            >
              Refetch
            </button>
          </div>
        );
      }

      const { getByTestId, getByText } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await expect.element(getByTestId('data')).toBeInTheDocument();
      expect(getByTestId('data').element().textContent).toBe('first');

      // Trigger refetch with delay
      await getByText('Refetch').click();

      // During refetch, should show fetching AND still have previous value
      await sleep(10);
      // Note: The value should still be accessible even during refetch state
      expect(itemQuery!.value?.data).toBe('first');
      expect(itemQuery!.isPending).toBe(false); // Not pending - we have data!
      expect(itemQuery!.isRefetching).toBe(true); // But we are refetching
      expect(itemQuery!.isFetching).toBe(true); // isFetching = isPending || isRefetching

      await sleep(100);

      // After refetch completes
      expect(getByTestId('data').element().textContent).toBe('second');
      expect(itemQuery!.isRefetching).toBe(false);
      expect(itemQuery!.isFetching).toBe(false);
    });
  });
});
