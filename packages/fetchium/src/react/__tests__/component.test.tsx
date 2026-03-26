import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'vitest-browser-react';
import { ContextProvider } from 'signalium/react';
import { component } from 'signalium/react';
import React, { useState } from 'react';
import { MemoryPersistentStore, SyncQueryStore } from '../../stores/sync.js';
import { QueryClient, QueryClientContext } from '../../QueryClient.js';
import { t } from '../../typeDefs.js';
import { Entity } from '../../proxy.js';
import { RESTQuery, fetchQuery } from '../../query.js';
import { createMockFetch, sleep } from '../../__tests__/utils.js';
import { createRenderCounter } from './utils.js';
import { QueryPromise } from 'src/types.js';

/**
 * React Component Tests for Query Package
 *
 * These tests use the component() helper from Signalium to create automatically
 * reactive components. Unlike the basic tests that use useReactive(), these tests
 * call query functions directly within the component body.
 */

describe('React Query Integration with component()', () => {
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

      class GetItem extends RESTQuery {
        path = '/item';
        result = { id: t.number, name: t.string };
      }

      const Component = component(() => {
        const item = fetchQuery(GetItem);

        if (item.isRejected) {
          return <div>Error: {String(item.error)}</div>;
        }

        if (!item.isReady) {
          return <div>Loading...</div>;
        }

        return <div>{item.value.name}</div>;
      });

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

      class GetItem extends RESTQuery {
        path = '/item';
        result = { id: t.number, name: t.string };
      }

      const Component = component(() => {
        const item = fetchQuery(GetItem);

        if (item.isRejected) {
          return <div>Error occurred</div>;
        }

        if (!item.isReady) {
          return <div>Loading...</div>;
        }

        return <div>{item.value.name}</div>;
      });

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

      class GetUser extends RESTQuery {
        path = '/user';
        result = { id: t.number, name: t.string };
      }

      class GetPosts extends RESTQuery {
        path = '/posts';
        result = {
          posts: t.array(
            t.object({
              id: t.number,
              title: t.string,
            }),
          ),
        };
      }

      const Component = component(() => {
        const user = fetchQuery(GetUser);
        const posts = fetchQuery(GetPosts);

        if (!user.isReady || !posts.isReady) {
          return <div>Loading...</div>;
        }

        return (
          <div>
            <span data-testid="user">{user.value.name}</span>
            <span data-testid="posts">{posts.value.posts.length} posts</span>
          </div>
        );
      });

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await expect.element(getByTestId('user')).toBeInTheDocument();
      await expect.element(getByTestId('posts')).toBeInTheDocument();

      // Wait for data to load
      await sleep(10);

      expect(getByTestId('user').element().textContent).toBe('Alice');
      expect(getByTestId('posts').element().textContent).toBe('1 posts');
    });

    it('should handle query with path parameters', async () => {
      mockFetch.get('/users/[id]', { id: 123, name: 'Bob' });

      class GetUser extends RESTQuery {
        params = { id: t.id };
        path = `/users/${this.params.id}`;
        result = { id: t.number, name: t.string };
      }

      const Component = component(() => {
        const user = fetchQuery(GetUser, { id: '123' });

        if (!user.isReady) {
          return <div>Loading...</div>;
        }

        return <div>{user.value.name}</div>;
      });

      const { getByText } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await expect.element(getByText('Bob')).toBeInTheDocument();
    });

    it('should handle query with dynamic parameters from state', async () => {
      mockFetch.get('/users/[id]', { id: 1, name: 'Alice' });
      mockFetch.get('/users/[id]', { id: 2, name: 'Bob' });

      class GetUser extends RESTQuery {
        params = { id: t.id };
        path = `/users/${this.params.id}`;
        result = { id: t.number, name: t.string };
      }

      const Component = component(() => {
        const [userId, setUserId] = useState('1');
        const user = fetchQuery(GetUser, { id: userId });

        return (
          <div>
            {user.isReady ? <div data-testid="name">{user.value.name}</div> : <div>Loading...</div>}
            <button onClick={() => setUserId('2')}>Switch User</button>
          </div>
        );
      });

      const { getByTestId, getByText } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await expect.element(getByTestId('name')).toBeInTheDocument();
      expect(getByTestId('name').element().textContent).toBe('Alice');

      await getByText('Switch User').click();
      await sleep(10);

      expect(getByTestId('name').element().textContent).toBe('Bob');
    });
  });

  describe('Entity Updates and Reactivity', () => {
    it('should update component when entity data changes', async () => {
      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
      }

      mockFetch.get('/user/[id]', { __typename: 'User', id: '1', name: 'Alice' });
      mockFetch.get('/user/[id]', { __typename: 'User', id: '1', name: 'Alice Updated' });

      class GetUser extends RESTQuery {
        params = { id: t.id };
        path = `/user/${this.params.id}`;
        result = t.entity(User);
      }

      const Counter = createRenderCounter(({ user }: { user: { name: string } }) => <div>{user.name}</div>, component);

      let userQuery: QueryPromise<GetUser>;

      const Component = component(() => {
        userQuery = fetchQuery(GetUser, { id: '1' });

        if (!userQuery.isReady) {
          return <div>Loading...</div>;
        }

        return <Counter user={userQuery.value} />;
      });

      const { getByText, getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await expect.element(getByText('Alice')).toBeInTheDocument();
      expect(Counter.renderCount).toBe(2);

      // Trigger refetch
      await userQuery!.value!.__refetch();

      await expect.element(getByText('Alice Updated')).toBeInTheDocument();
      expect(getByTestId(String(Counter.testId))).toBeDefined();
      expect(Counter.renderCount).toBe(3);
    });

    it('should keep multiple components in sync when sharing entity data', async () => {
      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
      }

      mockFetch.get('/user/[id]', { __typename: 'User', id: '1', name: 'Alice' });
      mockFetch.get('/user/[id]', { __typename: 'User', id: '1', name: 'Alice Smith' });

      class GetUser extends RESTQuery {
        params = { id: t.id };
        path = `/user/${this.params.id}`;
        result = t.entity(User);
      }

      const UserName = component(({ user }: { user: { name: string } }) => {
        return <span data-testid="name">{user.name}</span>;
      });

      const UserGreeting = component(({ user }: { user: { name: string } }) => {
        return <span data-testid="greeting">Hello, {user.name}!</span>;
      });

      const Component = component(() => {
        const result = fetchQuery(GetUser, { id: '1' });

        if (!result.isReady) {
          return <div>Loading...</div>;
        }

        const user = result.value as any;
        return (
          <div>
            <UserName user={user} />
            <UserGreeting user={user} />
            <button
              onClick={async () => {
                await result.value.__refetch();
              }}
            >
              Update
            </button>
          </div>
        );
      });

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
      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
        email = t.string;
      }

      class Post extends Entity {
        __typename = t.typename('Post');
        id = t.id;
        title = t.string;
        content = t.string;
        author = t.entity(User);
      }

      // Two completely different API endpoints
      mockFetch.get('/user/[id]', { __typename: 'User', id: '1', name: 'Alice', email: 'alice@example.com' });
      mockFetch.get('/posts/[postId]', {
        __typename: 'Post',
        id: '100',
        title: 'My Post',
        content: 'Post content here',
        author: { __typename: 'User', id: '1', name: 'Alice', email: 'alice@example.com' },
      });

      // Second request to update the user
      mockFetch.get('/user/[id]', {
        __typename: 'User',
        id: '1',
        name: 'Alice Updated',
        email: 'alice.updated@example.com',
      });

      // Two separate query definitions
      class GetUser extends RESTQuery {
        params = { id: t.id };
        path = `/user/${this.params.id}`;
        result = t.entity(User);
      }

      class GetPost extends RESTQuery {
        params = { postId: t.id };
        path = `/posts/${this.params.postId}`;
        result = t.entity(Post);
      }

      // First component - displays user profile from user endpoint
      const UserProfile = component(() => {
        const result = fetchQuery(GetUser, { id: '1' });

        if (!result.isReady) {
          return <div>Profile Loading...</div>;
        }

        return (
          <div data-testid="profile">
            <div data-testid="profile-name">{(result.value as any).name}</div>
            <div data-testid="profile-email">{(result.value as any).email}</div>
          </div>
        );
      });

      // Second component - displays post with nested author from post endpoint
      const PostView = component(() => {
        const result = fetchQuery(GetPost, { postId: '100' });

        if (!result.isReady) {
          return <div>Post Loading...</div>;
        }

        const post = result.value as any;
        return (
          <div data-testid="post">
            <div data-testid="post-title">{post.title}</div>
            <div data-testid="post-author-name">{post.author.name}</div>
            <div data-testid="post-author-email">{post.author.email}</div>
            <button
              onClick={async () => {
                // Refetch the USER endpoint, not the post
                const userResult = fetchQuery(GetUser, { id: '1' });
                await userResult.value!.__refetch();
              }}
            >
              Refresh User
            </button>
          </div>
        );
      });

      // App component - renders both independently
      const App = component(() => {
        return (
          <div>
            <UserProfile />
            <PostView />
          </div>
        );
      });

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

    it('should not rerender parent components when only child components change', async () => {
      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
      }

      mockFetch.get('/user/[id]', { __typename: 'User', id: '1', name: 'Alice' }, { delay: 50 });
      mockFetch.get('/user/[id]', { __typename: 'User', id: '1', name: 'Alice Smith' });

      class GetUser extends RESTQuery {
        params = { id: t.id };
        path = `/user/${this.params.id}`;
        result = t.entity(User);
      }

      let mainRenderCount = 0;
      let profileRenderCount = 0;
      let nameRenderCount = 0;
      let greetingRenderCount = 0;

      const UserProfile = component(({ userPromise }: { userPromise: QueryPromise<GetUser> }) => {
        profileRenderCount++;

        if (!userPromise.isReady) {
          return <div>Loading...</div>;
        }

        const user = userPromise.value;

        return (
          <div>
            UserProfile
            <UserName user={user} />
            <UserGreeting user={user} />
          </div>
        );
      });

      const UserName = component(({ user }: { user: { name: string } }) => {
        nameRenderCount++;
        return <span data-testid="name">{user.name}</span>;
      });

      const UserGreeting = component(({ user }: { user: { name: string } }) => {
        greetingRenderCount++;
        return <span data-testid="greeting">Hello, {user.name}!</span>;
      });

      const Component = component(() => {
        mainRenderCount++;
        const promise = fetchQuery(GetUser, { id: '1' });

        return (
          <div>
            <UserProfile userPromise={promise} />
            <button
              onClick={async () => {
                await promise.value!.__refetch();
              }}
            >
              Update
            </button>
          </div>
        );
      });

      const { getByTestId, getByText } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await expect.element(getByText('Loading...')).toBeInTheDocument();

      expect(mainRenderCount).toBe(2);
      expect(profileRenderCount).toBe(2);
      expect(nameRenderCount).toBe(0);
      expect(greetingRenderCount).toBe(0);

      await expect.element(getByTestId('name')).toBeInTheDocument();
      await expect.element(getByTestId('greeting')).toBeInTheDocument();

      expect(mainRenderCount).toBe(2);
      expect(profileRenderCount).toBe(3);
      expect(nameRenderCount).toBe(2);
      expect(greetingRenderCount).toBe(2);

      expect(getByTestId('name').element().textContent).toBe('Alice');
      expect(getByTestId('greeting').element().textContent).toBe('Hello, Alice!');

      // Click button to refetch and update entity
      await getByText('Update').click();
      await sleep(10);

      expect(mainRenderCount).toBe(2);
      expect(profileRenderCount).toBe(3);
      expect(nameRenderCount).toBe(3);
      expect(greetingRenderCount).toBe(3);

      // Both components should show updated data
      expect(getByTestId('name').element().textContent).toBe('Alice Smith');
      expect(getByTestId('greeting').element().textContent).toBe('Hello, Alice Smith!');
    });

    it('should handle nested entities correctly', async () => {
      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
      }

      class Post extends Entity {
        __typename = t.typename('Post');
        id = t.id;
        title = t.string;
        author = t.entity(User);
      }

      mockFetch.get('/post/[id]', {
        __typename: 'Post',
        id: '1',
        title: 'My Post',
        author: {
          __typename: 'User',
          id: '5',
          name: 'Alice',
        },
      });

      class GetPost extends RESTQuery {
        params = { id: t.id };
        path = `/post/${this.params.id}`;
        result = t.entity(Post);
      }

      const Component = component(() => {
        const result = fetchQuery(GetPost, { id: '1' });

        if (!result.isReady) {
          return <div>Loading...</div>;
        }

        const post = result.value as any;
        return (
          <div>
            <div data-testid="title">{post.title}</div>
            <div data-testid="author">{post.author.name}</div>
          </div>
        );
      });

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
      class User extends Entity {
        __typename = t.typename('User');
        id = t.id;
        name = t.string;
        isAdmin = t.boolean;
      }

      mockFetch.get('/user', { __typename: 'User', id: '1', name: 'Alice', isAdmin: true });

      class GetUser extends RESTQuery {
        path = '/user';
        result = t.entity(User);
      }

      const Component = component(() => {
        const result = fetchQuery(GetUser);

        if (!result.isReady) {
          return <div>Loading...</div>;
        }

        const user = result.value as any;
        return (
          <div>
            <div data-testid="name">{user.name}</div>
            {user.isAdmin && <div data-testid="admin-badge">Admin</div>}
          </div>
        );
      });

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
    it('should deduplicate multiple components using same query', async () => {
      mockFetch.get('/counter', { count: 5 });

      class GetCounter extends RESTQuery {
        path = '/counter';
        result = { count: t.number };
      }

      const ComponentA = component(() => {
        const result = fetchQuery(GetCounter);
        return <div data-testid="a">{result.isReady ? result.value.count : 'Loading'}</div>;
      });

      const ComponentB = component(() => {
        const result = fetchQuery(GetCounter);
        return <div data-testid="b">{result.isReady ? result.value.count : 'Loading'}</div>;
      });

      const App = component(() => {
        return (
          <div>
            <ComponentA />
            <ComponentB />
          </div>
        );
      });

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

      class GetCounter extends RESTQuery {
        path = '/counter';
        result = { count: t.number };
      }

      const Component = component(() => {
        const result = fetchQuery(GetCounter);

        return (
          <div>
            <div data-testid="count">{result.isReady ? result.value.count : 'Loading'}</div>
            <button
              onClick={async () => {
                mockFetch.get('/counter', { count: (result.value?.count ?? 0) + 1 });
                await result.value!.__refetch();
              }}
            >
              Refetch
            </button>
          </div>
        );
      });

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

    it('should work with nested components', async () => {
      mockFetch.get('/item', { id: 1, name: 'Test' });

      class GetItem extends RESTQuery {
        path = '/item';
        result = { id: t.number, name: t.string };
      }

      const Child = component(() => {
        const item = fetchQuery(GetItem);
        return <div data-testid="child">{item.isReady ? item.value.name : 'Loading'}</div>;
      });

      const Parent = component(() => {
        return (
          <div>
            <Child />
          </div>
        );
      });

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Parent />
        </ContextProvider>,
      );

      await expect.element(getByTestId('child')).toBeInTheDocument();
      await sleep(10);
      expect(getByTestId('child').element().textContent).toBe('Test');
    });
  });

  describe('Async Promise States', () => {
    it('should update all promise properties correctly', async () => {
      mockFetch.get('/item', { data: 'test' }, { delay: 50 });

      class GetItem extends RESTQuery {
        path = '/item';
        result = { data: t.string };
      }

      const states: Array<{
        isPending: boolean;
        isResolved: boolean;
        isRejected: boolean;
        isSettled: boolean;
        isReady: boolean;
        hasValue: boolean;
        hasError: boolean;
      }> = [];

      const Component = component(() => {
        const result = fetchQuery(GetItem);

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
      });

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

      class GetItem extends RESTQuery {
        path = '/item';
        result = { data: t.string };
        config = { retry: false } as any;
      }

      const Component = component(() => {
        const result = fetchQuery(GetItem as any) as any;

        if (result.isPending) {
          return <div data-testid="status">Pending</div>;
        }

        if (result.isRejected) {
          return <div data-testid="status">Rejected</div>;
        }

        return <div data-testid="status">Success</div>;
      });

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

      class GetItem extends RESTQuery {
        path = '/slow';
        result = { data: t.string };
      }

      const Component = component(() => {
        const result = fetchQuery(GetItem);

        return (
          <div>
            {result.isPending && <div data-testid="spinner">Loading...</div>}
            {result.isReady && <div data-testid="content">{result.value.data}</div>}
          </div>
        );
      });

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

      class GetItem extends RESTQuery {
        path = '/item';
        result = { data: t.string };
      }

      let itemQuery: QueryPromise<GetItem>;

      const Component = component(() => {
        itemQuery = fetchQuery(GetItem);

        return (
          <div>
            {itemQuery.isPending && <div data-testid="loading">Loading</div>}
            {itemQuery.isReady && <div data-testid="data">{itemQuery.value.data}</div>}
            <button
              onClick={async () => {
                mockFetch.get('/item', { data: 'second' }, { delay: 50 });
                await itemQuery.value!.__refetch();
              }}
            >
              Refetch
            </button>
          </div>
        );
      });

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
      expect(itemQuery!.isPending).toBe(true); // Pending - we are refetching
      expect(itemQuery!.isReady).toBe(true); // Ready - we do have data!

      await sleep(100);

      // After refetch completes
      expect(getByTestId('data').element().textContent).toBe('second');
    });
  });
});
