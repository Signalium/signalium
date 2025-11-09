import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'vitest-browser-react';
import { ContextProvider, useReactive } from 'signalium/react';
import React from 'react';
import { SyncQueryStore, MemoryPersistentStore } from '../../QueryStore.js';
import { QueryClient, QueryClientContext } from '../../QueryClient.js';
import { entity, t } from '../../typeDefs.js';
import { query, streamQuery } from '../../query.js';
import { createMockFetch, sleep } from '../../__tests__/utils.js';

/**
 * Stream-Query Cross-Compatibility Tests
 *
 * Tests that streams and queries properly share entity state.
 * When a stream updates an entity, queries should reflect the update, and vice versa.
 */

describe('Stream-Query Cross-Compatibility', () => {
  let client: QueryClient;
  let mockFetch: ReturnType<typeof createMockFetch>;

  beforeEach(() => {
    client?.destroy();
    const store = new SyncQueryStore(new MemoryPersistentStore());
    mockFetch = createMockFetch();
    client = new QueryClient(store, { fetch: mockFetch as any });
  });

  describe('Stream updates reflect in Query', () => {
    it('should update query result when stream updates the same entity', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
        status: t.string,
      }));

      let streamUpdateCallback: ((update: any) => void) | undefined;

      // Setup query
      mockFetch.get('/users/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          name: 'Alice',
          status: 'offline',
        },
      });

      const getUser = query(() => ({
        path: '/users/[id]',
        response: { user: User },
      }));

      const streamUserStatus = streamQuery(() => ({
        response: User,
        subscribe: (params, onUpdate) => {
          streamUpdateCallback = onUpdate;
          return () => {};
        },
      }));

      function Component(): React.ReactNode {
        const queryResult = useReactive(getUser, { id: '1' });
        const streamResult = useReactive(streamUserStatus);

        if (!queryResult.isReady) {
          return <div>Loading query...</div>;
        }

        return (
          <div>
            <div data-testid="query-name">{queryResult.value.user.name}</div>
            <div data-testid="query-status">{queryResult.value.user.status}</div>
            {streamResult.value && (
              <>
                <div data-testid="stream-name">{streamResult.value.name}</div>
                <div data-testid="stream-status">{streamResult.value.status}</div>
              </>
            )}
          </div>
        );
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      // Wait for query to load
      await sleep(50);
      await expect.element(getByTestId('query-name')).toHaveTextContent('Alice');
      await expect.element(getByTestId('query-status')).toHaveTextContent('offline');

      // Stream updates the same user entity
      streamUpdateCallback!({
        __typename: 'User',
        id: '1',
        name: 'Alice Smith',
        status: 'online',
      });

      await sleep(50);

      // Query result should reflect the stream update (same entity)
      await expect.element(getByTestId('query-name')).toHaveTextContent('Alice Smith');
      await expect.element(getByTestId('query-status')).toHaveTextContent('online');

      // Stream result should also have the data
      await expect.element(getByTestId('stream-name')).toHaveTextContent('Alice Smith');
      await expect.element(getByTestId('stream-status')).toHaveTextContent('online');
    });

    it('should merge nested updates from stream into query entity', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
        profile: t.object({
          bio: t.string,
          avatar: t.string,
        }),
      }));

      let streamUpdateCallback: ((update: any) => void) | undefined;

      mockFetch.get('/users/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          name: 'Alice',
          profile: {
            bio: 'Software Engineer',
            avatar: 'avatar1.jpg',
          },
        },
      });

      const getUser = query(() => ({
        path: '/users/[id]',
        response: { user: User },
      }));

      const streamUser = streamQuery(() => ({
        response: User,
        subscribe: (params, onUpdate) => {
          streamUpdateCallback = onUpdate;
          return () => {};
        },
      }));

      function Component(): React.ReactNode {
        const queryResult = useReactive(() => getUser({ id: '1' }));
        const streamResult = useReactive(streamUser);

        if (queryResult.isPending) {
          return <div>Loading...</div>;
        }

        return (
          <div>
            <div data-testid="query-bio">{queryResult.value!.user.profile.bio}</div>
            <div data-testid="query-avatar">{queryResult.value!.user.profile.avatar}</div>
          </div>
        );
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await sleep(50);
      await expect.element(getByTestId('query-bio')).toHaveTextContent('Software Engineer');
      await expect.element(getByTestId('query-avatar')).toHaveTextContent('avatar1.jpg');

      // Stream sends nested update
      streamUpdateCallback!({
        __typename: 'User',
        id: '1',
        name: 'Alice',
        profile: {
          bio: 'Senior Software Engineer',
          avatar: 'avatar2.jpg',
        },
      });

      await sleep(50);

      // Query should reflect nested update
      await expect.element(getByTestId('query-bio')).toHaveTextContent('Senior Software Engineer');
      await expect.element(getByTestId('query-avatar')).toHaveTextContent('avatar2.jpg');
    });
  });

  describe('Query updates reflect in Stream', () => {
    it('should update stream result when query refetches the same entity', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
        email: t.string,
      }));

      let streamUpdateCallback: ((update: any) => void) | undefined;

      // Initial query fetch
      mockFetch.get('/users/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          name: 'Alice',
          email: 'alice@example.com',
        },
      });

      const getUser = query(() => ({
        path: '/users/[id]',
        response: { user: User },
      }));

      const streamUser = streamQuery(() => ({
        response: User,
        subscribe: (params, onUpdate) => {
          streamUpdateCallback = onUpdate;
          // Send initial stream data
          setTimeout(() => {
            onUpdate({
              __typename: 'User',
              id: '1',
              name: 'Alice',
              email: 'alice@example.com',
            });
          }, 10);
          return () => {};
        },
      }));

      function Component(): React.ReactNode {
        const queryResult = useReactive(() => getUser({ id: '1' }));
        const streamResult = useReactive(streamUser);

        if (queryResult.isPending || streamResult.isPending) {
          return <div>Loading...</div>;
        }

        return (
          <div>
            <div data-testid="query-name">{queryResult.value!.user.name}</div>
            <div data-testid="query-email">{queryResult.value!.user.email}</div>
            <div data-testid="stream-name">{streamResult.value!.name}</div>
            <div data-testid="stream-email">{streamResult.value!.email}</div>
            <button onClick={() => queryResult.refetch()}>Refetch</button>
          </div>
        );
      }

      const { getByTestId, getByText } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      // Wait for initial data
      await sleep(100);
      await expect.element(getByTestId('query-name')).toHaveTextContent('Alice');
      await expect.element(getByTestId('stream-name')).toHaveTextContent('Alice');

      // Update mock for refetch
      mockFetch.get('/users/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          name: 'Alice Smith',
          email: 'alice.smith@example.com',
        },
      });

      // Trigger refetch via button
      await getByText('Refetch').click();
      await sleep(50);

      // Both query and stream should reflect the update (same entity)
      await expect.element(getByTestId('query-name')).toHaveTextContent('Alice Smith');
      await expect.element(getByTestId('query-email')).toHaveTextContent('alice.smith@example.com');
      await expect.element(getByTestId('stream-name')).toHaveTextContent('Alice Smith');
      await expect.element(getByTestId('stream-email')).toHaveTextContent('alice.smith@example.com');
    });

    it('should merge query data with partial stream updates', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
        email: t.string,
        lastSeen: t.string,
      }));

      let streamUpdateCallback: ((update: any) => void) | undefined;

      mockFetch.get('/users/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          name: 'Alice',
          email: 'alice@example.com',
          lastSeen: '2024-01-01',
        },
      });

      const getUser = query(() => ({
        path: '/users/[id]',
        response: { user: User },
      }));

      const streamUserPresence = streamQuery(() => ({
        response: User,
        subscribe: (params, onUpdate) => {
          streamUpdateCallback = onUpdate;
          return () => {};
        },
      }));

      function Component(): React.ReactNode {
        const queryResult = useReactive(() => getUser({ id: '1' }));
        const streamResult = useReactive(streamUserPresence);

        if (queryResult.isPending) {
          return <div>Loading...</div>;
        }

        return (
          <div>
            <div data-testid="name">{queryResult.value!.user.name}</div>
            <div data-testid="email">{queryResult.value!.user.email}</div>
            <div data-testid="lastSeen">{queryResult.value!.user.lastSeen}</div>
          </div>
        );
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await sleep(50);
      await expect.element(getByTestId('name')).toHaveTextContent('Alice');
      await expect.element(getByTestId('lastSeen')).toHaveTextContent('2024-01-01');

      // Stream sends partial update (only lastSeen)
      streamUpdateCallback!({
        __typename: 'User',
        id: '1',
        lastSeen: '2024-01-15',
      });

      await sleep(50);

      // Query should show merged data
      await expect.element(getByTestId('name')).toHaveTextContent('Alice');
      await expect.element(getByTestId('email')).toHaveTextContent('alice@example.com');
      await expect.element(getByTestId('lastSeen')).toHaveTextContent('2024-01-15');
    });
  });
});
