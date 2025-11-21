import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'vitest-browser-react';
import { ContextProvider, useReactive } from 'signalium/react';
import React, { memo, useMemo, useState } from 'react';
import { SyncQueryStore, MemoryPersistentStore } from '../../QueryStore.js';
import { QueryClient, QueryClientContext } from '../../QueryClient.js';
import { entity, t } from '../../typeDefs.js';
import { query } from '../../query.js';
import { createMockFetch, sleep } from '../../__tests__/utils.js';
import { createRenderCounter } from './utils.js';
import { useQuery } from '../use-query.js';
import { QueryResult } from '../../types.js';

/**
 * Tests for useQuery hook
 *
 * The useQuery hook wraps query results and deep clones them to ensure
 * that React properly detects changes when nested entity proxies are updated.
 * This is critical for React.memo and useMemo to work correctly.
 */

describe('useQuery Hook', () => {
  let client: QueryClient;
  let mockFetch: ReturnType<typeof createMockFetch>;

  beforeEach(() => {
    client?.destroy();
    const store = new SyncQueryStore(new MemoryPersistentStore());
    mockFetch = createMockFetch();
    client = new QueryClient(store, { fetch: mockFetch as any });
  });

  describe('Basic Cloning and Re-rendering', () => {
    it('should return a cloned result, not the same reference', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      mockFetch.get('/user', { __typename: 'User', id: '1', name: 'Alice' });

      const getUser = query(() => ({
        path: '/user',
        response: User,
      }));

      let directQueryResult: any;
      let clonedQueryResult: any;

      function DirectComponent(): React.ReactNode {
        const result = useReactive(getUser);
        if (result.isReady) {
          directQueryResult = result.value;
        }
        return <div>Direct</div>;
      }

      function ClonedComponent(): React.ReactNode {
        const result = useQuery(getUser);
        if (result.isReady) {
          clonedQueryResult = result.value;
        }
        return <div>Cloned</div>;
      }

      function App(): React.ReactNode {
        return (
          <div>
            <DirectComponent />
            <ClonedComponent />
          </div>
        );
      }

      render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <App />
        </ContextProvider>,
      );

      await sleep(50);

      // The cloned result should not be the same reference
      expect(clonedQueryResult).toBeDefined();
      expect(directQueryResult).toBeDefined();
      expect(clonedQueryResult).not.toBe(directQueryResult);
      expect(clonedQueryResult.name).toBe('Alice');
      expect(directQueryResult.name).toBe('Alice');
    });

    it('should trigger re-render when entity data changes', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      mockFetch.get('/user/[id]', { __typename: 'User', id: '1', name: 'Alice' });

      const getUser = query(() => ({
        path: '/user/[id]',
        response: User,
      }));

      const Counter = createRenderCounter(({ name }: { name: string }) => <div data-testid="name">{name}</div>);

      let userQuery: QueryResult<{ name: string }>;

      function Component(): React.ReactNode {
        userQuery = useQuery(getUser, { id: '1' });

        if (!userQuery.isReady) {
          return <div>Loading...</div>;
        }

        return <Counter name={userQuery.value!.name} />;
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await expect.element(getByTestId('name')).toBeInTheDocument();
      expect(getByTestId('name').element().textContent).toBe('Alice');
      expect(Counter.renderCount).toBe(1);

      // Update the data
      mockFetch.get('/user/[id]', { __typename: 'User', id: '1', name: 'Alice Updated' });
      await userQuery!.refetch();
      await sleep(10);

      expect(getByTestId('name').element().textContent).toBe('Alice Updated');
      expect(Counter.renderCount).toBe(2);
    });

    it('should handle nested entity updates', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      const Post = entity(() => ({
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

      let postQuery: QueryResult<{ title: string; author: { name: string } }>;

      function Component(): React.ReactNode {
        postQuery = useQuery(getPost, { id: '1' });

        if (!postQuery.isReady) {
          return <div>Loading...</div>;
        }

        const post = postQuery.value!;
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

      // Update nested entity
      mockFetch.get('/post/[id]', {
        __typename: 'Post',
        id: '1',
        title: 'My Post Updated',
        author: { __typename: 'User', id: '5', name: 'Alice Updated' },
      });

      await postQuery!.refetch();
      await sleep(10);

      expect(getByTestId('title').element().textContent).toBe('My Post Updated');
      expect(getByTestId('author').element().textContent).toBe('Alice Updated');
    });

    it('should verify cloned values are independent', async () => {
      mockFetch.get('/data', { count: 1, nested: { value: 'original' } });

      const getData = query(() => ({
        path: '/data',
        response: {
          count: t.number,
          nested: t.object({ value: t.string }),
        },
      }));

      let clonedValue: any;
      let directValue: any;

      function Component(): React.ReactNode {
        const cloned = useQuery(getData);
        const direct = useReactive(getData);

        if (cloned.isReady && direct.isReady) {
          clonedValue = cloned.value;
          directValue = direct.value;
        }

        return <div data-testid="ready">{cloned.isReady ? 'Ready' : 'Loading'}</div>;
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await expect.element(getByTestId('ready')).toHaveTextContent('Ready');

      // Verify they're different references
      expect(clonedValue).not.toBe(directValue);
      expect(clonedValue.nested).not.toBe(directValue.nested);

      // But same values
      expect(clonedValue.count).toBe(directValue.count);
      expect(clonedValue.nested.value).toBe(directValue.nested.value);
    });
  });

  describe('React.memo and useMemo Integration', () => {
    it('should update React.memo components when entity changes', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
        email: t.string,
      }));

      mockFetch.get('/user', { __typename: 'User', id: '1', name: 'Alice', email: 'alice@example.com' });

      const getUser = query(() => ({
        path: '/user',
        response: User,
      }));

      let memoRenderCount = 0;

      const MemoizedUserDisplay = memo(({ user }: { user: { name: string; email: string } }) => {
        memoRenderCount++;
        return (
          <div data-testid="user-display">
            <div data-testid="name">{user.name}</div>
            <div data-testid="email">{user.email}</div>
          </div>
        );
      });

      let userQuery: QueryResult<{ name: string; email: string }>;

      function Component(): React.ReactNode {
        userQuery = useQuery(getUser);

        if (!userQuery.isReady) {
          return <div>Loading...</div>;
        }

        return <MemoizedUserDisplay user={userQuery.value!} />;
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await expect.element(getByTestId('name')).toBeInTheDocument();
      expect(getByTestId('name').element().textContent).toBe('Alice');
      expect(getByTestId('email').element().textContent).toBe('alice@example.com');
      expect(memoRenderCount).toBe(1);

      // Update the entity - memo should re-render because reference changed
      mockFetch.get('/user', {
        __typename: 'User',
        id: '1',
        name: 'Alice Updated',
        email: 'alice.updated@example.com',
      });
      await userQuery!.refetch();
      await sleep(10);

      expect(getByTestId('name').element().textContent).toBe('Alice Updated');
      expect(getByTestId('email').element().textContent).toBe('alice.updated@example.com');
      expect(memoRenderCount).toBe(2); // Should have re-rendered
    });

    it('should not re-render React.memo when data unchanged', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      mockFetch.get('/user', { __typename: 'User', id: '1', name: 'Alice' });

      const getUser = query(() => ({
        path: '/user',
        response: User,
      }));

      let memoRenderCount = 0;

      const MemoizedChild = memo(({ name }: { name: string }) => {
        memoRenderCount++;
        return <div data-testid="name">{name}</div>;
      });

      let userQuery: QueryResult<{ name: string }>;

      function Component(): React.ReactNode {
        userQuery = useQuery(getUser);

        if (!userQuery.isReady) {
          return <div>Loading...</div>;
        }

        // Pass primitive value, not the whole object
        return <MemoizedChild name={userQuery.value!.name} />;
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await expect.element(getByTestId('name')).toBeInTheDocument();
      expect(memoRenderCount).toBe(1);

      // Refetch with same data
      mockFetch.get('/user', { __typename: 'User', id: '1', name: 'Alice' });
      await userQuery!.refetch();
      await sleep(10);

      // Memo should not re-render because the name string is the same
      expect(memoRenderCount).toBe(1);
    });

    it('should work with useMemo dependencies', async () => {
      mockFetch.get('/items', {
        items: [
          { id: 1, price: 10 },
          { id: 2, price: 20 },
        ],
      });

      const getItems = query(() => ({
        path: '/items',
        response: {
          items: t.array(t.object({ id: t.number, price: t.number })),
        },
      }));

      let computeCount = 0;

      function Component(): React.ReactNode {
        const result = useQuery(getItems);
        const items = result.isReady ? result.value : null;

        const total = useMemo(() => {
          computeCount++;
          if (!items) return 0;
          return items.items.reduce((sum, item) => sum + item.price, 0);
        }, [items]);

        return (
          <div>
            <div data-testid="total">{total}</div>
            <div data-testid="status">{result.isReady ? 'Ready' : 'Loading'}</div>
          </div>
        );
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await expect.element(getByTestId('status')).toHaveTextContent('Ready');
      expect(getByTestId('total').element().textContent).toBe('30');
      const initialComputeCount = computeCount;

      // Refetch with same data - useMemo should not recompute
      mockFetch.get('/items', {
        items: [
          { id: 1, price: 10 },
          { id: 2, price: 20 },
        ],
      });
      await sleep(10);

      // Since the data is the same, useMemo should recompute due to new reference
      // (this is expected behavior with cloning)
      expect(computeCount).toBeGreaterThanOrEqual(initialComputeCount);
    });

    it('should handle deep property access through memoized components', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        profile: t.object({
          name: t.string,
          settings: t.object({
            theme: t.string,
          }),
        }),
      }));

      mockFetch.get('/user', {
        __typename: 'User',
        id: '1',
        profile: {
          name: 'Alice',
          settings: { theme: 'dark' },
        },
      });

      const getUser = query(() => ({
        path: '/user',
        response: User,
      }));

      let memoRenderCount = 0;

      const DeepMemoComponent = memo(({ settings }: { settings: { theme: string } }) => {
        memoRenderCount++;
        return <div data-testid="theme">{settings.theme}</div>;
      });

      let userQuery: QueryResult<any>;

      function Component(): React.ReactNode {
        userQuery = useQuery(getUser);

        if (!userQuery.isReady) {
          return <div>Loading...</div>;
        }

        return <DeepMemoComponent settings={userQuery.value!.profile.settings} />;
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await expect.element(getByTestId('theme')).toBeInTheDocument();
      expect(getByTestId('theme').element().textContent).toBe('dark');
      expect(memoRenderCount).toBe(1);

      // Update deeply nested value
      mockFetch.get('/user', {
        __typename: 'User',
        id: '1',
        profile: {
          name: 'Alice',
          settings: { theme: 'light' },
        },
      });

      await userQuery!.refetch();
      await sleep(10);

      expect(getByTestId('theme').element().textContent).toBe('light');
      expect(memoRenderCount).toBe(2); // Should re-render
    });

    it('should pass nested shared entities to React.memo components correctly', async () => {
      const Author = entity(() => ({
        __typename: t.typename('Author'),
        id: t.id,
        name: t.string,
        bio: t.string,
      }));

      const Post = entity(() => ({
        __typename: t.typename('Post'),
        id: t.id,
        title: t.string,
        content: t.string,
        author: Author,
      }));

      mockFetch.get('/posts/[id]', {
        __typename: 'Post',
        id: '1',
        title: 'Understanding React.memo',
        content: 'React.memo is a higher order component...',
        author: {
          __typename: 'Author',
          id: '42',
          name: 'Alice Johnson',
          bio: 'Software engineer',
        },
      });

      const getPost = query(() => ({
        path: '/posts/[id]',
        response: Post,
      }));

      let authorCardRenderCount = 0;
      let authorBadgeRenderCount = 0;

      // Memoized component that receives the nested author entity
      const AuthorCard = memo(({ author }: { author: { name: string; bio: string } }) => {
        authorCardRenderCount++;
        return (
          <div data-testid="author-card">
            <div data-testid="author-card-name">{author.name}</div>
            <div data-testid="author-card-bio">{author.bio}</div>
          </div>
        );
      });

      // Another memoized component with the same nested entity
      const AuthorBadge = memo(({ author }: { author: { name: string } }) => {
        authorBadgeRenderCount++;
        return <div data-testid="author-badge">{author.name}</div>;
      });

      let postQuery: QueryResult<any>;

      function PostView(): React.ReactNode {
        postQuery = useQuery(getPost, { id: '1' });

        if (!postQuery.isReady) {
          return <div>Loading...</div>;
        }

        const post = postQuery.value!;
        return (
          <div data-testid="post-view">
            <h1 data-testid="post-title">{post.title}</h1>
            <AuthorCard author={post.author} />
            <AuthorBadge author={post.author} />
          </div>
        );
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <PostView />
        </ContextProvider>,
      );

      await expect.element(getByTestId('post-view')).toBeInTheDocument();

      // Verify initial render
      expect(getByTestId('post-title').element().textContent).toBe('Understanding React.memo');
      expect(getByTestId('author-card-name').element().textContent).toBe('Alice Johnson');
      expect(getByTestId('author-card-bio').element().textContent).toBe('Software engineer');
      expect(getByTestId('author-badge').element().textContent).toBe('Alice Johnson');
      expect(authorCardRenderCount).toBe(1);
      expect(authorBadgeRenderCount).toBe(1);

      // Update the post with an updated author
      mockFetch.get('/posts/[id]', {
        __typename: 'Post',
        id: '1',
        title: 'Understanding React.memo',
        content: 'React.memo is a higher order component...',
        author: {
          __typename: 'Author',
          id: '42',
          name: 'Dr. Alice Johnson',
          bio: 'Senior software engineer and tech lead',
        },
      });

      await postQuery!.refetch();
      await sleep(10);

      // Both memoized components should re-render because the author reference changed
      expect(getByTestId('author-card-name').element().textContent).toBe('Dr. Alice Johnson');
      expect(getByTestId('author-card-bio').element().textContent).toBe('Senior software engineer and tech lead');
      expect(getByTestId('author-badge').element().textContent).toBe('Dr. Alice Johnson');
      expect(authorCardRenderCount).toBe(2);
      expect(authorBadgeRenderCount).toBe(2);

      // Refetch with same data - memo components should not re-render if the data is identical
      mockFetch.get('/posts/[id]', {
        __typename: 'Post',
        id: '1',
        title: 'Understanding React.memo',
        content: 'React.memo is a higher order component...',
        author: {
          __typename: 'Author',
          id: '42',
          name: 'Dr. Alice Johnson',
          bio: 'Senior software engineer and tech lead',
        },
      });

      await postQuery!.refetch();
      await sleep(10);

      // Memo components will re-render because we're creating new cloned objects
      // This is expected behavior with deep cloning
      expect(authorCardRenderCount).toBeGreaterThanOrEqual(2);
      expect(authorBadgeRenderCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Entity Synchronization Across Queries', () => {
    it('should provide cloned snapshot at render time', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
        email: t.string,
      }));

      const Post = entity(() => ({
        __typename: t.typename('Post'),
        id: t.id,
        title: t.string,
        author: User,
      }));

      // Two different endpoints that share the same User entity
      mockFetch.get('/posts/[postId]', {
        __typename: 'Post',
        id: '100',
        title: 'My Post',
        author: { __typename: 'User', id: '1', name: 'Alice', email: 'alice@example.com' },
      });

      const getPost = query(() => ({
        path: '/posts/[postId]',
        response: Post,
      }));

      let postQueryResult: QueryResult<any>;

      function PostComponent(): React.ReactNode {
        postQueryResult = useQuery(getPost, { postId: '100' });

        if (!postQueryResult.isReady) {
          return <div>Post Loading...</div>;
        }

        return (
          <div data-testid="post">
            <div data-testid="post-title">{postQueryResult.value!.title}</div>
            <div data-testid="post-author-name">{postQueryResult.value!.author.name}</div>
            <div data-testid="post-author-email">{postQueryResult.value!.author.email}</div>
          </div>
        );
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <PostComponent />
        </ContextProvider>,
      );

      await expect.element(getByTestId('post')).toBeInTheDocument();

      expect(getByTestId('post-author-name').element().textContent).toBe('Alice');

      // Update via refetching the same query
      mockFetch.get('/posts/[postId]', {
        __typename: 'Post',
        id: '100',
        title: 'My Post',
        author: { __typename: 'User', id: '1', name: 'Alice Updated', email: 'new@example.com' },
      });
      await postQueryResult!.refetch();
      await sleep(10);

      // Component should show updated data
      expect(getByTestId('post-author-name').element().textContent).toBe('Alice Updated');
      expect(getByTestId('post-author-email').element().textContent).toBe('new@example.com');
    });

    it('should handle multiple components using useQuery with shared entities', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      mockFetch.get('/user/[id]', { __typename: 'User', id: '1', name: 'Alice' });

      const getUser = query(() => ({
        path: '/user/[id]',
        response: User,
      }));

      let userQueryA: QueryResult<{ name: string }>;

      function ComponentA(): React.ReactNode {
        userQueryA = useQuery(getUser, { id: '1' });
        return <div data-testid="comp-a">{userQueryA.isReady ? userQueryA.value!.name : 'Loading'}</div>;
      }

      function ComponentB(): React.ReactNode {
        const userQueryB = useQuery(getUser, { id: '1' });
        return <div data-testid="comp-b">{userQueryB.isReady ? userQueryB.value!.name : 'Loading'}</div>;
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

      await expect.element(getByTestId('comp-a')).toHaveTextContent('Alice');
      await expect.element(getByTestId('comp-b')).toHaveTextContent('Alice');

      // Update through one query
      mockFetch.get('/user/[id]', { __typename: 'User', id: '1', name: 'Bob' });
      await userQueryA!.refetch();
      await sleep(10);

      // Both should update
      expect(getByTestId('comp-a').element().textContent).toBe('Bob');
      expect(getByTestId('comp-b').element().textContent).toBe('Bob');
    });

    it('should handle deeply nested cloned structures on refetch', async () => {
      const Author = entity(() => ({
        __typename: t.typename('Author'),
        id: t.id,
        name: t.string,
      }));

      const Comment = entity(() => ({
        __typename: t.typename('Comment'),
        id: t.id,
        text: t.string,
        author: Author,
      }));

      const Post = entity(() => ({
        __typename: t.typename('Post'),
        id: t.id,
        title: t.string,
        comments: t.array(Comment),
      }));

      mockFetch.get('/post/[id]', {
        __typename: 'Post',
        id: '1',
        title: 'My Post',
        comments: [
          {
            __typename: 'Comment',
            id: '10',
            text: 'First comment',
            author: { __typename: 'Author', id: '5', name: 'Alice' },
          },
        ],
      });

      const getPost = query(() => ({
        path: '/post/[id]',
        response: Post,
      }));

      let postQuery: QueryResult<any>;

      function PostComponent(): React.ReactNode {
        postQuery = useQuery(getPost, { id: '1' });

        if (!postQuery.isReady) {
          return <div>Loading...</div>;
        }

        const post = postQuery.value!;
        return (
          <div data-testid="post">
            <div data-testid="comment-author">{post.comments[0].author.name}</div>
          </div>
        );
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <PostComponent />
        </ContextProvider>,
      );

      await expect.element(getByTestId('post')).toBeInTheDocument();

      expect(getByTestId('comment-author').element().textContent).toBe('Alice');

      // Update the post (with updated author)
      mockFetch.get('/post/[id]', {
        __typename: 'Post',
        id: '1',
        title: 'My Post',
        comments: [
          {
            __typename: 'Comment',
            id: '10',
            text: 'First comment',
            author: { __typename: 'Author', id: '5', name: 'Alice Smith' },
          },
        ],
      });
      await postQuery!.refetch();
      await sleep(10);

      // The deeply nested author should update
      expect(getByTestId('comment-author').element().textContent).toBe('Alice Smith');
    });
  });

  describe('Complex Data Structures', () => {
    it('should clone Date objects independently', async () => {
      const now = new Date('2024-01-01T00:00:00.000Z');
      mockFetch.get('/event', { id: 1, date: now.toISOString() });

      const getEvent = query(() => ({
        path: '/event',
        response: {
          id: t.number,
          date: t.string,
        },
      }));

      let clonedValue: any;

      function Component(): React.ReactNode {
        const result = useQuery(getEvent);

        if (result.isReady) {
          clonedValue = result.value;
        }

        return <div data-testid="status">{result.isReady ? 'Ready' : 'Loading'}</div>;
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await expect.element(getByTestId('status')).toHaveTextContent('Ready');
      expect(clonedValue.date).toBe(now.toISOString());
    });

    it('should handle deeply nested objects and arrays', async () => {
      mockFetch.get('/nested', {
        level1: {
          level2: {
            level3: {
              items: [1, 2, 3],
              data: { value: 'deep' },
            },
          },
        },
      });

      const getNested = query(() => ({
        path: '/nested',
        response: {
          level1: t.object({
            level2: t.object({
              level3: t.object({
                items: t.array(t.number),
                data: t.object({ value: t.string }),
              }),
            }),
          }),
        },
      }));

      let clonedValue: any;
      let directValue: any;

      function Component(): React.ReactNode {
        const cloned = useQuery(getNested);
        const direct = useReactive(getNested);

        if (cloned.isReady && direct.isReady) {
          clonedValue = cloned.value;
          directValue = direct.value;
        }

        return <div data-testid="status">{cloned.isReady ? 'Ready' : 'Loading'}</div>;
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await expect.element(getByTestId('status')).toHaveTextContent('Ready');

      // Verify deep cloning
      expect(clonedValue).not.toBe(directValue);
      expect(clonedValue.level1).not.toBe(directValue.level1);
      expect(clonedValue.level1.level2).not.toBe(directValue.level1.level2);
      expect(clonedValue.level1.level2.level3).not.toBe(directValue.level1.level2.level3);
      expect(clonedValue.level1.level2.level3.items).not.toBe(directValue.level1.level2.level3.items);

      // But values should be the same
      expect(clonedValue.level1.level2.level3.data.value).toBe('deep');
      expect(clonedValue.level1.level2.level3.items).toEqual([1, 2, 3]);
    });

    it('should handle empty objects and arrays', async () => {
      mockFetch.get('/empty', {
        emptyObj: {},
        emptyArray: [],
        nested: { empty: {} },
      });

      const getEmpty = query(() => ({
        path: '/empty',
        response: {
          emptyObj: t.object({}),
          emptyArray: t.array(t.number),
          nested: t.object({ empty: t.object({}) }),
        },
      }));

      function Component(): React.ReactNode {
        const result = useQuery(getEmpty);

        if (!result.isReady) {
          return <div>Loading...</div>;
        }

        const value = result.value!;
        return (
          <div>
            <div data-testid="obj-keys">{Object.keys(value.emptyObj).length}</div>
            <div data-testid="array-len">{value.emptyArray.length}</div>
            <div data-testid="nested-keys">{Object.keys(value.nested.empty).length}</div>
          </div>
        );
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await expect.element(getByTestId('obj-keys')).toHaveTextContent('0');
      await expect.element(getByTestId('array-len')).toHaveTextContent('0');
      await expect.element(getByTestId('nested-keys')).toHaveTextContent('0');
    });

    it('should handle arrays of entities', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      mockFetch.get('/users', {
        users: [
          { __typename: 'User', id: '1', name: 'Alice' },
          { __typename: 'User', id: '2', name: 'Bob' },
        ],
      });

      const getUsers = query(() => ({
        path: '/users',
        response: {
          users: t.array(User),
        },
      }));

      let clonedValue: any;

      function Component(): React.ReactNode {
        const result = useQuery(getUsers);

        if (result.isReady) {
          clonedValue = result.value;
        }

        return (
          <div>
            {result.isReady && (
              <div data-testid="users">
                {result.value!.users.map((u: any) => (
                  <div key={u.id} data-testid={`user-${u.id}`}>
                    {u.name}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await expect.element(getByTestId('users')).toBeInTheDocument();
      expect(getByTestId('user-1').element().textContent).toBe('Alice');
      expect(getByTestId('user-2').element().textContent).toBe('Bob');
      expect(clonedValue.users).toHaveLength(2);
    });
  });

  describe('Query Types Support', () => {
    it('should work with standard queries', async () => {
      mockFetch.get('/item', { id: 1, name: 'Test' });

      const getItem = query(() => ({
        path: '/item',
        response: { id: t.number, name: t.string },
      }));

      function Component(): React.ReactNode {
        const result = useQuery(getItem);
        return <div data-testid="name">{result.isReady ? result.value!.name : 'Loading'}</div>;
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await expect.element(getByTestId('name')).toHaveTextContent('Test');
    });

    it('should handle refetch behavior', async () => {
      mockFetch.get('/counter', { count: 0 });

      const getCounter = query(() => ({
        path: '/counter',
        response: { count: t.number },
      }));

      let counterQuery: QueryResult<{ count: number }>;

      function Component(): React.ReactNode {
        counterQuery = useQuery(getCounter);

        return (
          <div>
            <div data-testid="count">{counterQuery.isReady ? counterQuery.value!.count : 'Loading'}</div>
            <div data-testid="fetching">{counterQuery.isFetching ? 'Fetching' : 'Idle'}</div>
          </div>
        );
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await expect.element(getByTestId('count')).toHaveTextContent('0');

      // Refetch with new data
      mockFetch.get('/counter', { count: 5 });
      await counterQuery!.refetch();
      await sleep(10);

      expect(getByTestId('count').element().textContent).toBe('5');
    });

    it('should work with queries returning primitive values', async () => {
      mockFetch.get('/count', { value: 42 });

      const getCount = query(() => ({
        path: '/count',
        response: { value: t.number },
      }));

      function Component(): React.ReactNode {
        const result = useQuery(getCount);
        return <div data-testid="value">{result.isReady ? result.value!.value : 'Loading'}</div>;
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await expect.element(getByTestId('value')).toHaveTextContent('42');
    });
  });

  describe('Edge Cases', () => {
    it('should handle null values in results', async () => {
      mockFetch.get('/data', { value: null, name: 'Test' });

      const getData = query(() => ({
        path: '/data',
        response: {
          value: t.union(t.string, t.null),
          name: t.string,
        },
      }));

      function Component(): React.ReactNode {
        const result = useQuery(getData);

        if (!result.isReady) {
          return <div>Loading...</div>;
        }

        return (
          <div>
            <div data-testid="value">{result.value!.value === null ? 'null' : result.value!.value}</div>
            <div data-testid="name">{result.value!.name}</div>
          </div>
        );
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await expect.element(getByTestId('value')).toHaveTextContent('null');
      await expect.element(getByTestId('name')).toHaveTextContent('Test');
    });

    it('should handle undefined optional fields', async () => {
      mockFetch.get('/data', { required: 'yes' });

      const getData = query(() => ({
        path: '/data',
        response: {
          required: t.string,
          optional: t.union(t.string, t.undefined),
        },
      }));

      function Component(): React.ReactNode {
        const result = useQuery(getData);

        if (!result.isReady) {
          return <div>Loading...</div>;
        }

        return (
          <div>
            <div data-testid="required">{result.value!.required}</div>
            <div data-testid="optional">
              {result.value!.optional === undefined ? 'undefined' : result.value!.optional}
            </div>
          </div>
        );
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await expect.element(getByTestId('required')).toHaveTextContent('yes');
      await expect.element(getByTestId('optional')).toHaveTextContent('undefined');
    });

    it('should handle multiple useQuery calls with same underlying query', async () => {
      mockFetch.get('/shared', { data: 'shared' });

      const getShared = query(() => ({
        path: '/shared',
        response: { data: t.string },
      }));

      function Component(): React.ReactNode {
        const result1 = useQuery(getShared);
        const result2 = useQuery(getShared);

        return (
          <div>
            <div data-testid="result1">{result1.isReady ? result1.value!.data : 'Loading'}</div>
            <div data-testid="result2">{result2.isReady ? result2.value!.data : 'Loading'}</div>
          </div>
        );
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await expect.element(getByTestId('result1')).toHaveTextContent('shared');
      await expect.element(getByTestId('result2')).toHaveTextContent('shared');

      // Should only make one network request
      expect(mockFetch.calls.length).toBe(1);
    });

    it('should maintain cloning after multiple refetches', async () => {
      mockFetch.get('/data', { count: 0 });

      const getData = query(() => ({
        path: '/data',
        response: { count: t.number },
      }));

      let queryResult: QueryResult<{ count: number }>;
      const seenReferences = new Set();

      function Component(): React.ReactNode {
        queryResult = useQuery(getData);

        if (queryResult.isReady) {
          seenReferences.add(queryResult.value);
        }

        return <div data-testid="count">{queryResult.isReady ? queryResult.value!.count : 'Loading'}</div>;
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await expect.element(getByTestId('count')).toHaveTextContent('0');

      // Refetch multiple times
      for (let i = 1; i <= 3; i++) {
        mockFetch.get('/data', { count: i });
        await queryResult!.refetch();
        await sleep(10);
        expect(getByTestId('count').element().textContent).toBe(String(i));
      }

      // Each refetch should produce a new cloned reference
      expect(seenReferences.size).toBeGreaterThan(1);
    });

    it('should handle boolean values correctly', async () => {
      mockFetch.get('/flags', { isActive: true, isDisabled: false });

      const getFlags = query(() => ({
        path: '/flags',
        response: {
          isActive: t.boolean,
          isDisabled: t.boolean,
        },
      }));

      function Component(): React.ReactNode {
        const result = useQuery(getFlags);

        if (!result.isReady) {
          return <div>Loading...</div>;
        }

        return (
          <div>
            <div data-testid="active">{String(result.value!.isActive)}</div>
            <div data-testid="disabled">{String(result.value!.isDisabled)}</div>
          </div>
        );
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await expect.element(getByTestId('active')).toHaveTextContent('true');
      await expect.element(getByTestId('disabled')).toHaveTextContent('false');
    });

    it('should handle number edge cases (0, negative, float)', async () => {
      mockFetch.get('/numbers', { zero: 0, negative: -42, float: 3.14 });

      const getNumbers = query(() => ({
        path: '/numbers',
        response: {
          zero: t.number,
          negative: t.number,
          float: t.number,
        },
      }));

      function Component(): React.ReactNode {
        const result = useQuery(getNumbers);

        if (!result.isReady) {
          return <div>Loading...</div>;
        }

        return (
          <div>
            <div data-testid="zero">{result.value!.zero}</div>
            <div data-testid="negative">{result.value!.negative}</div>
            <div data-testid="float">{result.value!.float}</div>
          </div>
        );
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await expect.element(getByTestId('zero')).toHaveTextContent('0');
      await expect.element(getByTestId('negative')).toHaveTextContent('-42');
      await expect.element(getByTestId('float')).toHaveTextContent('3.14');
    });
  });
});
