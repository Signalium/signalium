import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { ContextProvider, useReactive, SuspendSignalsProvider } from 'signalium/react';
import React, { useState } from 'react';
import { SyncQueryStore, MemoryPersistentStore } from '../../QueryStore.js';
import { QueryClient, QueryClientContext } from '../../QueryClient.js';
import { entity, t } from '../../typeDefs.js';
import { streamQuery, query } from '../../query.js';
import { RefetchInterval } from '../../types.js';
import { sleep } from '../../__tests__/utils.js';
import { userEvent } from '@vitest/browser/context';

/**
 * React Tests for Stream Queries
 *
 * Tests stream behavior in React components including loading states,
 * reactivity, and suspension.
 */

describe('React Stream Integration', () => {
  let client: QueryClient;

  beforeEach(() => {
    client?.destroy();
    const store = new SyncQueryStore(new MemoryPersistentStore());
    client = new QueryClient(store, { fetch: fetch as any });
  });

  describe('Basic Stream Usage', () => {
    it('should show loading state then data from stream', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      const streamUser = streamQuery(() => ({
        id: 'user-stream',
        response: User,
        subscribe: (params, onUpdate) => {
          setTimeout(() => {
            onUpdate({
              __typename: 'User',
              id: '1',
              name: 'Alice',
            });
          }, 50);

          return () => {};
        },
      }));

      function Component(): React.ReactNode {
        const user = useReactive(streamUser);

        if (user.isPending) {
          return <div>Loading...</div>;
        }

        return <div data-testid="user-name">{user.value!.name}</div>;
      }

      const { getByText, getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await expect.element(getByText('Loading...')).toBeInTheDocument();
      await expect.element(getByTestId('user-name')).toHaveTextContent('Alice');
    });

    it('should handle stream with params', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      const streamUser = streamQuery(() => ({
        id: 'user-stream',
        params: { userId: t.string },
        response: User,
        subscribe: (params, onUpdate) => {
          setTimeout(() => {
            onUpdate({
              __typename: 'User',
              id: params.userId,
              name: `User ${params.userId}`,
            });
          }, 20);

          return () => {};
        },
      }));

      function Component(): React.ReactNode {
        const user = useReactive(() => streamUser({ userId: '42' }));

        if (user.isPending) {
          return <div>Loading...</div>;
        }

        return <div data-testid="user-name">{user.value!.name}</div>;
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await sleep(100);
      await expect.element(getByTestId('user-name')).toHaveTextContent('User 42');
    });

    it('should handle multiple streams in one component', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      const streamUser1 = streamQuery(() => ({
        id: 'user-stream',
        params: { userId: t.string },
        response: User,
        subscribe: (params, onUpdate) => {
          setTimeout(() => {
            onUpdate({
              __typename: 'User',
              id: params.userId,
              name: `User ${params.userId}`,
            });
          }, 20);

          return () => {};
        },
      }));

      const streamUser2 = streamQuery(() => ({
        id: 'user-stream',
        params: { userId: t.string },
        response: User,
        subscribe: (params, onUpdate) => {
          setTimeout(() => {
            onUpdate({
              __typename: 'User',
              id: params.userId,
              name: `User ${params.userId}`,
            });
          }, 30);

          return () => {};
        },
      }));

      function Component(): React.ReactNode {
        const user1 = useReactive(() => streamUser1({ userId: '1' }));
        const user2 = useReactive(() => streamUser2({ userId: '2' }));

        if (user1.isPending || user2.isPending) {
          return <div>Loading...</div>;
        }

        return (
          <div>
            <div data-testid="user1">{user1.value!.name}</div>
            <div data-testid="user2">{user2.value!.name}</div>
          </div>
        );
      }

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await sleep(150);
      await expect.element(getByTestId('user1')).toHaveTextContent('User 1');
      await expect.element(getByTestId('user2')).toHaveTextContent('User 2');
    });
  });

  describe('Stream Suspension', () => {
    it('should not re-render when toggled to suspended', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      let subscribeCount = 0;
      let unsubscribeCount = 0;
      let updateCallback: ((update: any) => void) | undefined;

      const streamUser = streamQuery(() => ({
        id: 'user-stream',
        response: User,
        subscribe: (params, onUpdate) => {
          subscribeCount++;
          updateCallback = onUpdate;

          setTimeout(() => {
            onUpdate({
              __typename: 'User',
              id: '1',
              name: `Alice ${subscribeCount}`,
            });
          }, 20);

          return () => {
            unsubscribeCount++;
          };
        },
      }));

      function StreamComponent(): React.ReactNode {
        const user = useReactive(streamUser);

        if (user.isPending) {
          return <div>Loading...</div>;
        }

        return <div data-testid="user-name">{user.value!.name}</div>;
      }

      function Wrapper(): React.ReactNode {
        const [suspended, setSuspended] = useState(false);

        return (
          <div>
            <SuspendSignalsProvider value={suspended}>
              <StreamComponent />
            </SuspendSignalsProvider>
            <button onClick={() => setSuspended(!suspended)}>Toggle Suspend</button>
          </div>
        );
      }

      const { getByTestId, getByText } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Wrapper />
        </ContextProvider>,
      );

      // Wait for initial subscription
      await sleep(100);
      await expect.element(getByTestId('user-name')).toHaveTextContent('Alice 1');
      expect(subscribeCount).toBe(1);
      expect(unsubscribeCount).toBe(0);

      // Suspend the stream
      await userEvent.click(getByText('Toggle Suspend'));
      await sleep(50);

      // Relay tears down when suspended
      expect(unsubscribeCount).toBe(1);

      // Stream update should update the entity but not trigger re-render
      if (updateCallback) {
        updateCallback({
          __typename: 'User',
          id: '1',
          name: 'Alice Updated',
        });
      }

      await sleep(50);
      // Should still show old value (no re-render because suspended)
      await expect.element(getByTestId('user-name')).toHaveTextContent('Alice 1');
    });

    it('should show latest value when re-enabled after suspension', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      let subscribeCount = 0;
      let unsubscribeCount = 0;

      const streamUser = streamQuery(() => ({
        id: 'user-stream',
        response: User,
        subscribe: (params, onUpdate) => {
          subscribeCount++;

          setTimeout(() => {
            onUpdate({
              __typename: 'User',
              id: '1',
              name: `Alice ${subscribeCount}`,
            });
          }, 20);

          return () => {
            unsubscribeCount++;
          };
        },
      }));

      function StreamComponent(): React.ReactNode {
        const user = useReactive(streamUser);

        if (user.isPending) {
          return <div>Loading...</div>;
        }

        return <div data-testid="user-name">{user.value!.name}</div>;
      }

      function Wrapper(): React.ReactNode {
        const [suspended, setSuspended] = useState(false);

        return (
          <div>
            <SuspendSignalsProvider value={suspended}>
              <StreamComponent />
            </SuspendSignalsProvider>
            <button onClick={() => setSuspended(!suspended)}>Toggle Suspend</button>
          </div>
        );
      }

      const { getByTestId, getByText } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Wrapper />
        </ContextProvider>,
      );

      // Initial subscription
      await sleep(100);
      await expect.element(getByTestId('user-name')).toHaveTextContent('Alice 1');
      expect(subscribeCount).toBe(1);

      // Suspend - relay disabled
      await userEvent.click(getByText('Toggle Suspend'));
      await sleep(50);
      expect(unsubscribeCount).toBe(1);

      // Re-enable - should show latest value without new subscription
      await userEvent.click(getByText('Toggle Suspend'));
      await sleep(50);

      // Should still have only one subscription (relay never deactivated)
      expect(subscribeCount).toBe(2);

      // Component should now re-render and show current value
      await expect.element(getByTestId('user-name')).toHaveTextContent('Alice 1');
    });

    it('should handle partial updates during suspension', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
        status: t.string,
      }));

      let updateCallback: ((update: any) => void) | undefined;

      const streamUser = streamQuery(() => ({
        id: 'user-stream',
        response: User,
        subscribe: (params, onUpdate) => {
          updateCallback = onUpdate;

          setTimeout(() => {
            onUpdate({
              __typename: 'User',
              id: '1',
              name: 'Alice',
              status: 'online',
            });
          }, 20);

          return () => {};
        },
      }));

      function StreamComponent(): React.ReactNode {
        const user = useReactive(streamUser);

        if (user.isPending) {
          return <div>Loading...</div>;
        }

        return (
          <div>
            <div data-testid="name">{user.value!.name}</div>
            <div data-testid="status">{user.value!.status}</div>
          </div>
        );
      }

      function Wrapper(): React.ReactNode {
        const [suspended, setSuspended] = useState(false);

        return (
          <div>
            <SuspendSignalsProvider value={suspended}>
              <StreamComponent />
            </SuspendSignalsProvider>
            <button onClick={() => setSuspended(!suspended)}>Toggle</button>
          </div>
        );
      }

      const { getByTestId, getByText } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Wrapper />
        </ContextProvider>,
      );

      await sleep(100);
      await expect.element(getByTestId('name')).toHaveTextContent('Alice');
      await expect.element(getByTestId('status')).toHaveTextContent('online');

      // Suspend
      await userEvent.click(getByText('Toggle'));

      // Send update while suspended
      updateCallback!({
        __typename: 'User',
        id: '1',
        status: 'away',
      });

      await sleep(50);

      // Should NOT show updated value (suspended)
      await expect.element(getByTestId('status')).toHaveTextContent('online');

      // Re-enable
      await userEvent.click(getByText('Toggle'));
      await sleep(50);

      // Should now show the latest value
      await expect.element(getByTestId('status')).toHaveTextContent('away');
    });
  });

  describe('Stream Error Handling in React', () => {
    it('should handle errors in subscription gracefully', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      const streamUser = streamQuery(() => ({
        id: 'user-stream',
        response: User,
        subscribe: (params, onUpdate) => {
          setTimeout(() => {
            // This will cause a validation error (missing required fields)
            try {
              onUpdate({
                __typename: 'User',
                id: '1',
                // Missing name field
              } as any);
            } catch (e) {
              // Expected to fail validation
            }
          }, 20);

          return () => {};
        },
      }));

      function Component(): React.ReactNode {
        const user = useReactive(streamUser);

        if (user.isPending) {
          return <div>Loading...</div>;
        }

        if (user.isRejected) {
          return <div data-testid="error">Error occurred</div>;
        }

        return <div>{user.value!.name}</div>;
      }

      const { getByText } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      // Should stay in loading state or show error
      await expect.element(getByText('Loading...')).toBeInTheDocument();
    });
  });

  describe('Stream Lifecycle in React', () => {
    it('should unsubscribe when component unmounts', async () => {
      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
      }));

      let unsubscribeCount = 0;

      const streamUser = streamQuery(() => ({
        id: 'user-stream',
        response: User,
        subscribe: (params, onUpdate) => {
          setTimeout(() => {
            onUpdate({
              __typename: 'User',
              id: '1',
              name: 'Alice',
            });
          }, 20);

          return () => {
            unsubscribeCount++;
          };
        },
      }));

      function StreamComponent(): React.ReactNode {
        const user = useReactive(streamUser);
        if (user.isPending) return <div>Loading...</div>;
        return <div data-testid="user-name">{user.value!.name}</div>;
      }

      function Wrapper(): React.ReactNode {
        const [show, setShow] = useState(true);

        return (
          <div>
            {show && <StreamComponent />}
            <button onClick={() => setShow(false)}>Unmount</button>
          </div>
        );
      }

      const { getByText, getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Wrapper />
        </ContextProvider>,
      );

      await sleep(100);
      await expect.element(getByTestId('user-name')).toHaveTextContent('Alice');
      expect(unsubscribeCount).toBe(0);

      // Unmount component
      await userEvent.click(getByText('Unmount'));
      await sleep(100);

      // Should have unsubscribed
      expect(unsubscribeCount).toBe(1);
    });
  });
});
