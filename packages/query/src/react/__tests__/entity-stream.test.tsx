import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'vitest-browser-react';
import { ContextProvider, SuspendSignalsProvider, component } from 'signalium/react';
import React, { useState } from 'react';
import { MemoryPersistentStore, SyncQueryStore } from '../../stores/sync.js';
import { QueryClient, QueryClientContext } from '../../QueryClient.js';
import { entity, t } from '../../typeDefs.js';
import { query } from '../../query.js';
import { createMockFetch, sleep } from '../../__tests__/utils.js';
import { userEvent } from '@vitest/browser/context';

/**
 * React Tests for Entity Streaming
 *
 * Tests entity streaming behavior in React components including re-rendering,
 * multiple components, suspension, and lifecycle.
 */

describe('React Entity Stream Integration', () => {
  let client: QueryClient;
  let mockFetch: ReturnType<typeof createMockFetch>;

  beforeEach(() => {
    client?.destroy();
    const store = new SyncQueryStore(new MemoryPersistentStore());
    mockFetch = createMockFetch();
    client = new QueryClient(store, { fetch: mockFetch as any });
  });

  describe('Component Re-rendering', () => {
    it('should re-render component when entity receives stream updates', async () => {
      let streamCallback: ((update: any) => void) | undefined;

      const User = entity(
        () => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
        }),
        undefined,
        {
          stream: {
            subscribe: (context, id, onUpdate) => {
              streamCallback = onUpdate;
              return () => {};
            },
          },
        },
      );

      const getUser = query(() => ({
        path: '/user/[id]',
        response: { user: User },
      }));

      const Component = component(() => {
        const result = getUser({ id: '1' });

        if (result.isPending) {
          return <div>Loading...</div>;
        }

        return <div data-testid="user-name">{result.value!.user.name}</div>;
      });

      mockFetch.get('/user/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          name: 'Alice',
        },
      });

      const { getByText, getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await expect.element(getByText('Loading...')).toBeInTheDocument();
      await expect.element(getByTestId('user-name')).toHaveTextContent('Alice');

      // Wait for stream to activate
      await sleep(50);
      expect(streamCallback).toBeDefined();

      // Send stream update
      streamCallback!({
        name: 'Alice Updated',
      });

      // Wait for notifier to propagate and component to re-render
      await sleep(50);

      // Component should re-render with updated value
      await expect.element(getByTestId('user-name')).toHaveTextContent('Alice Updated');
    });
  });

  describe('Multiple Components', () => {
    it('should keep multiple different components in sync when sharing same entity', async () => {
      let streamCallback: ((update: any) => void) | undefined;

      const User = entity(
        () => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
        }),
        undefined,
        {
          stream: {
            subscribe: (context, id, onUpdate) => {
              streamCallback = onUpdate;
              return () => {};
            },
          },
        },
      );

      const getUser = query(() => ({
        path: '/user/[id]',
        response: { user: User },
      }));

      const Component1 = component(() => {
        const result = getUser({ id: '1' });

        if (result.isPending) {
          return <div>Loading 1...</div>;
        }

        return <div data-testid="user-1">{result.value!.user.name}</div>;
      });

      const Component2 = component(() => {
        const result = getUser({ id: '1' });

        if (result.isPending) {
          return <div>Loading 2...</div>;
        }

        return <div data-testid="user-2">{result.value!.user.name}</div>;
      });

      mockFetch.get('/user/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          name: 'Alice',
        },
      });

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component1 />
          <Component2 />
        </ContextProvider>,
      );

      await sleep(100);

      await expect.element(getByTestId('user-1')).toHaveTextContent('Alice');
      await expect.element(getByTestId('user-2')).toHaveTextContent('Alice');

      // Wait for stream to activate
      await sleep(50);
      expect(streamCallback).toBeDefined();

      // Send stream update
      streamCallback!({
        name: 'Alice Updated',
      });

      // Wait for notifier to propagate and components to re-render
      await sleep(50);

      // Both components should update
      await expect.element(getByTestId('user-1')).toHaveTextContent('Alice Updated');
      await expect.element(getByTestId('user-2')).toHaveTextContent('Alice Updated');
    });

    it('should keep multiple instances of the same component in sync when sharing same entity', async () => {
      let streamCallback: ((update: any) => void) | undefined;

      const User = entity(
        () => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
        }),
        undefined,
        {
          stream: {
            subscribe: (context, id, onUpdate) => {
              streamCallback = onUpdate;
              return () => {};
            },
          },
        },
      );

      const getUser = query(() => ({
        path: '/user/[id]',
        response: { user: User },
      }));

      const Component = component(({ testId }: { testId: string }) => {
        const result = getUser({ id: '1' });

        if (result.isPending) {
          return <div>Loading 1...</div>;
        }

        return <div data-testid={testId}>{result.value!.user.name}</div>;
      });

      mockFetch.get('/user/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          name: 'Alice',
        },
      });

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component testId="user-1" />
          <Component testId="user-2" />
        </ContextProvider>,
      );

      await sleep(100);

      await expect.element(getByTestId('user-1')).toHaveTextContent('Alice');
      await expect.element(getByTestId('user-2')).toHaveTextContent('Alice');

      // Wait for stream to activate
      await sleep(50);
      expect(streamCallback).toBeDefined();

      // Send stream update
      streamCallback!({
        name: 'Alice Updated',
      });

      // Wait for notifier to propagate and components to re-render
      await sleep(50);

      // Both components should update
      await expect.element(getByTestId('user-1')).toHaveTextContent('Alice Updated');
      await expect.element(getByTestId('user-2')).toHaveTextContent('Alice Updated');
    });
  });

  describe('Entity in Query Result', () => {
    it('should work when entity is accessed from query result', async () => {
      let streamCallback: ((update: any) => void) | undefined;

      const User = entity(
        () => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
        }),
        undefined,
        {
          stream: {
            subscribe: (context, id, onUpdate) => {
              streamCallback = onUpdate;
              return () => {};
            },
          },
        },
      );

      const getUser = query(() => ({
        path: '/user/[id]',
        response: { user: User },
      }));

      const Component = component(() => {
        const result = getUser({ id: '1' });

        const user = result.value?.user;
        const userName = user?.name;

        if (result.isPending) {
          return <div>Loading...</div>;
        }

        return <div data-testid="user-name">{userName}</div>;
      });

      mockFetch.get('/user/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          name: 'Alice',
        },
      });

      const { getByText, getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await expect.element(getByText('Loading...')).toBeInTheDocument();
      await expect.element(getByTestId('user-name')).toHaveTextContent('Alice');

      // Wait for stream to activate
      await sleep(50);
      expect(streamCallback).toBeDefined();

      // Send stream update
      streamCallback!({
        name: 'Alice Updated',
      });

      // Wait for notifier to propagate and component to re-render
      await sleep(50);

      await expect.element(getByTestId('user-name')).toHaveTextContent('Alice Updated');
    });
  });

  describe('Loading States', () => {
    it('should not interfere with query loading states', async () => {
      const User = entity(
        () => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
        }),
        undefined,
        {
          stream: {
            subscribe: (context, id, onUpdate) => {
              return () => {};
            },
          },
        },
      );

      const getUser = query(() => ({
        path: '/user/[id]',
        response: { user: User },
      }));

      const Component = component(() => {
        const result = getUser({ id: '1' });

        if (result.isPending) {
          return <div data-testid="loading">Loading...</div>;
        }

        return <div data-testid="user-name">{result.value!.user.name}</div>;
      });

      mockFetch.get(
        '/user/[id]',
        {
          user: {
            __typename: 'User',
            id: '1',
            name: 'Alice',
          },
        },
        { delay: 100 },
      );

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      // Should show loading state first
      await expect.element(getByTestId('loading')).toBeInTheDocument();

      // Then show data
      await expect.element(getByTestId('user-name')).toHaveTextContent('Alice');
    });
  });

  describe('Component Unmounting', () => {
    it('should unsubscribe stream when component unmounts', async () => {
      let unsubscribeCallCount = 0;

      const User = entity(
        () => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
        }),
        undefined,
        {
          stream: {
            subscribe: (context, id, onUpdate) => {
              return () => {
                unsubscribeCallCount++;
              };
            },
          },
        },
      );

      const getUser = query(() => ({
        path: '/user/[id]',
        response: { user: User },
      }));

      const Component = component(() => {
        const result = getUser({ id: '1' });
        const userName = result.value?.user.name;

        if (result.isPending) {
          return <div>Loading...</div>;
        }

        return <div>{userName}</div>;
      });

      mockFetch.get('/user/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          name: 'Alice',
        },
      });

      const { unmount } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await sleep(100);

      // Unmount component
      unmount();

      await sleep(50);

      // Stream should unsubscribe
      expect(unsubscribeCallCount).toBeGreaterThan(0);
    });
  });

  describe('Conditional Rendering', () => {
    it('should activate/deactivate stream based on component visibility', async () => {
      let streamActivated = false;
      let unsubscribeCallCount = 0;

      const User = entity(
        () => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
        }),
        undefined,
        {
          stream: {
            subscribe: (context, id, onUpdate) => {
              streamActivated = true;
              return () => {
                unsubscribeCallCount++;
              };
            },
          },
        },
      );

      const getUser = query(() => ({
        path: '/user/[id]',
        response: { user: User },
      }));

      const Component = component(({ show }: { show: boolean }) => {
        const result = getUser({ id: '1' });

        if (result.isPending) {
          return <div>Loading...</div>;
        }

        if (!show) {
          return null;
        }

        return <div data-testid="user-name">{result.value!.user.name}</div>;
      });

      mockFetch.get('/user/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          name: 'Alice',
        },
      });

      function App() {
        const [show, setShow] = useState(true);

        return (
          <>
            <button onClick={() => setShow(!show)}>Toggle</button>
            <Component show={show} />
          </>
        );
      }

      const { getByTestId, getByRole } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <App />
        </ContextProvider>,
      );

      await sleep(100);

      await expect.element(getByTestId('user-name')).toBeInTheDocument();
      expect(streamActivated).toBe(true);

      // Hide component
      await userEvent.click(getByRole('button'));

      await sleep(50);

      // Stream should deactivate
      expect(unsubscribeCallCount).toBeGreaterThan(0);
    });
  });

  describe('Nested Entity Streaming', () => {
    it('should work correctly with nested entities in React components', async () => {
      let streamCallback: ((update: any) => void) | undefined;

      const Address = entity(
        () => ({
          __typename: t.typename('Address'),
          id: t.id,
          street: t.string,
        }),
        undefined,
        {
          stream: {
            subscribe: (context, id, onUpdate) => {
              streamCallback = onUpdate;
              return () => {};
            },
          },
        },
      );

      const User = entity(() => ({
        __typename: t.typename('User'),
        id: t.id,
        name: t.string,
        address: Address,
      }));

      const getUser = query(() => ({
        path: '/user/[id]',
        response: { user: User },
      }));

      const Component = component(() => {
        const result = getUser({ id: '1' });
        const addressStreet = result.value?.user.address.street;

        if (result.isPending) {
          return <div>Loading...</div>;
        }

        return <div data-testid="address-street">{addressStreet}</div>;
      });

      mockFetch.get('/user/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          name: 'Alice',
          address: {
            __typename: 'Address',
            id: '1',
            street: '123 Main St',
          },
        },
      });

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await sleep(100);

      await expect.element(getByTestId('address-street')).toHaveTextContent('123 Main St');

      // Wait for stream to activate
      await sleep(50);
      expect(streamCallback).toBeDefined();

      // Update nested entity via stream
      streamCallback!({
        street: '456 Oak Ave',
      });

      // Wait for notifier to propagate and component to re-render
      await sleep(50);

      await expect.element(getByTestId('address-street')).toHaveTextContent('456 Oak Ave');
    });
  });

  describe('Entity Methods in React', () => {
    it('should work correctly with entity methods in React components', async () => {
      let streamCallback: ((update: any) => void) | undefined;

      const User = entity(
        () => ({
          __typename: t.typename('User'),
          id: t.id,
          firstName: t.string,
          lastName: t.string,
        }),
        () => ({
          fullName() {
            return `${this.firstName} ${this.lastName}`;
          },
        }),
        {
          stream: {
            subscribe: (context, id, onUpdate) => {
              streamCallback = onUpdate;
              return () => {};
            },
          },
        },
      );

      const getUser = query(() => ({
        path: '/user/[id]',
        response: { user: User },
      }));

      const Component = component(() => {
        const result = getUser({ id: '1' });
        const fullName = result.value?.user.fullName();

        if (result.isPending) {
          return <div>Loading...</div>;
        }

        return <div data-testid="full-name">{fullName}</div>;
      });

      mockFetch.get('/user/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          firstName: 'Alice',
          lastName: 'Smith',
        },
      });

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await sleep(100);

      await expect.element(getByTestId('full-name')).toHaveTextContent('Alice Smith');

      // Wait for stream to activate
      await sleep(50);
      expect(streamCallback).toBeDefined();

      // Update via stream
      streamCallback!({
        firstName: 'Bob',
      });

      // Wait for notifier to propagate and component to re-render
      await sleep(50);

      await expect.element(getByTestId('full-name')).toHaveTextContent('Bob Smith');
    });
  });

  describe('Multiple Entity Instances', () => {
    it('should have separate streams for different entity instances in same component', async () => {
      const streamCallbacks: Map<string, (update: any) => void> = new Map();

      const User = entity(
        () => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
        }),
        undefined,
        {
          stream: {
            subscribe: (context, id, onUpdate) => {
              streamCallbacks.set(String(id), onUpdate);
              return () => {
                streamCallbacks.delete(String(id));
              };
            },
          },
        },
      );

      const getUser = query(() => ({
        path: '/user/[id]',
        response: { user: User },
      }));

      const Component = component(() => {
        const result1 = getUser({ id: '1' });
        const result2 = getUser({ id: '2' });
        const name1 = result1.value?.user.name;
        const name2 = result2.value?.user.name;

        if (result1.isPending || result2.isPending) {
          return <div>Loading...</div>;
        }

        return (
          <>
            <div data-testid="user-1">{name1}</div>
            <div data-testid="user-2">{name2}</div>
          </>
        );
      });

      mockFetch.get('/user/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          name: 'User 1',
        },
      });
      mockFetch.get('/user/[id]', {
        user: {
          __typename: 'User',
          id: '2',
          name: 'User 2',
        },
      });

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await sleep(100);

      await expect.element(getByTestId('user-1')).toHaveTextContent('User 1');
      await expect.element(getByTestId('user-2')).toHaveTextContent('User 2');

      // Wait for streams to activate
      await sleep(50);
      expect(streamCallbacks.get('1')).toBeDefined();
      expect(streamCallbacks.get('2')).toBeDefined();

      // Update user1
      streamCallbacks.get('1')!({ name: 'Updated User 1' });

      // Wait for notifier to propagate and component to re-render
      await sleep(50);

      await expect.element(getByTestId('user-1')).toHaveTextContent('Updated User 1');
      await expect.element(getByTestId('user-2')).toHaveTextContent('User 2');
    });
  });

  describe('Stream Updates During Render', () => {
    it('should handle stream updates during component render correctly', async () => {
      let streamCallback: ((update: any) => void) | undefined;

      const User = entity(
        () => ({
          __typename: t.typename('User'),
          id: t.id,
          count: t.number,
        }),
        undefined,
        {
          stream: {
            subscribe: (context, id, onUpdate) => {
              streamCallback = onUpdate;
              // Send update immediately
              setTimeout(() => {
                onUpdate({ count: 1 });
              }, 10);
              return () => {};
            },
          },
        },
      );

      const getUser = query(() => ({
        path: '/user/[id]',
        response: { user: User },
      }));

      const Component = component(() => {
        const result = getUser({ id: '1' });
        const count = result.value?.user.count;

        if (result.isPending) {
          return <div>Loading...</div>;
        }

        return <div data-testid="count">{count}</div>;
      });

      mockFetch.get('/user/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          count: 0,
        },
      });

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await sleep(100);

      // Should eventually show updated count
      await expect.element(getByTestId('count')).toHaveTextContent('1');
    });
  });

  describe('useReactive Hook', () => {
    it('should work with useReactive hook for entity streaming', async () => {
      let streamCallback: ((update: any) => void) | undefined;

      const User = entity(
        () => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
        }),
        undefined,
        {
          stream: {
            subscribe: (context, id, onUpdate) => {
              streamCallback = onUpdate;
              return () => {};
            },
          },
        },
      );

      const getUser = query(() => ({
        path: '/user/[id]',
        response: { user: User },
      }));

      const Component = component(() => {
        const result = getUser({ id: '1' });
        const userName = result.value?.user.name;

        if (result.isPending) {
          return <div>Loading...</div>;
        }

        return <div data-testid="user-name">{userName}</div>;
      });

      mockFetch.get('/user/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          name: 'Alice',
        },
      });

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await sleep(100);

      await expect.element(getByTestId('user-name')).toHaveTextContent('Alice');

      // Wait for stream to activate
      await sleep(50);
      expect(streamCallback).toBeDefined();

      streamCallback!({
        name: 'Alice Updated',
      });

      // Wait for notifier to propagate and component to re-render
      await sleep(50);

      await expect.element(getByTestId('user-name')).toHaveTextContent('Alice Updated');
    });
  });

  describe('Context Provider', () => {
    it('should work with QueryClientContext provider', async () => {
      let streamCallback: ((update: any) => void) | undefined;

      const User = entity(
        () => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
        }),
        undefined,
        {
          stream: {
            subscribe: (context, id, onUpdate) => {
              streamCallback = onUpdate;
              return () => {};
            },
          },
        },
      );

      const getUser = query(() => ({
        path: '/user/[id]',
        response: { user: User },
      }));

      const Component = component(() => {
        const result = getUser({ id: '1' });
        const userName = result.value?.user.name;

        if (result.isPending) {
          return <div>Loading...</div>;
        }

        return <div data-testid="user-name">{userName}</div>;
      });

      mockFetch.get('/user/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          name: 'Alice',
        },
      });

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await sleep(100);

      await expect.element(getByTestId('user-name')).toHaveTextContent('Alice');

      // Wait for stream to activate
      await sleep(50);
      expect(streamCallback).toBeDefined();

      streamCallback!({
        name: 'Alice Updated',
      });

      // Wait for notifier to propagate and component to re-render
      await sleep(50);

      await expect.element(getByTestId('user-name')).toHaveTextContent('Alice Updated');
    });
  });

  describe('Component Updates', () => {
    it('should update correctly when entity stream sends partial updates', async () => {
      let streamCallback: ((update: any) => void) | undefined;

      const User = entity(
        () => ({
          __typename: t.typename('User'),
          id: t.id,
          firstName: t.string,
          lastName: t.string,
          email: t.string,
        }),
        undefined,
        {
          stream: {
            subscribe: (context, id, onUpdate) => {
              streamCallback = onUpdate;
              return () => {};
            },
          },
        },
      );

      const getUser = query(() => ({
        path: '/user/[id]',
        response: { user: User },
      }));

      const Component = component(() => {
        const result = getUser({ id: '1' });
        const firstName = result.value?.user.firstName;
        const lastName = result.value?.user.lastName;
        const email = result.value?.user.email;

        if (result.isPending) {
          return <div>Loading...</div>;
        }

        return (
          <>
            <div data-testid="first-name">{firstName}</div>
            <div data-testid="last-name">{lastName}</div>
            <div data-testid="email">{email}</div>
          </>
        );
      });

      mockFetch.get('/user/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          firstName: 'Alice',
          lastName: 'Smith',
          email: 'alice@example.com',
        },
      });

      const { getByTestId } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await sleep(100);

      await expect.element(getByTestId('first-name')).toHaveTextContent('Alice');
      await expect.element(getByTestId('last-name')).toHaveTextContent('Smith');
      await expect.element(getByTestId('email')).toHaveTextContent('alice@example.com');

      // Wait for stream to activate
      await sleep(50);
      expect(streamCallback).toBeDefined();

      // Send partial update
      streamCallback!({
        firstName: 'Bob',
      });

      // Wait for notifier to propagate and component to re-render
      await sleep(50);

      // Only firstName should update
      await expect.element(getByTestId('first-name')).toHaveTextContent('Bob');
      await expect.element(getByTestId('last-name')).toHaveTextContent('Smith');
      await expect.element(getByTestId('email')).toHaveTextContent('alice@example.com');
    });
  });

  describe('Stream Cleanup', () => {
    it('should properly clean up stream when all components using entity unmount', async () => {
      let unsubscribeCallCount = 0;

      const User = entity(
        () => ({
          __typename: t.typename('User'),
          id: t.id,
          name: t.string,
        }),
        undefined,
        {
          stream: {
            subscribe: (context, id, onUpdate) => {
              return () => {
                unsubscribeCallCount++;
              };
            },
          },
        },
      );

      const getUser = query(() => ({
        path: '/user/[id]',
        response: { user: User },
      }));

      const Component = component(() => {
        const result = getUser({ id: '1' });
        const userName = result.value?.user.name;

        if (result.isPending) {
          return <div>Loading...</div>;
        }

        return <div data-testid="user-name">{userName}</div>;
      });

      mockFetch.get('/user/[id]', {
        user: {
          __typename: 'User',
          id: '1',
          name: 'Alice',
        },
      });

      const { unmount } = render(
        <ContextProvider contexts={[[QueryClientContext, client]]}>
          <Component />
        </ContextProvider>,
      );

      await sleep(100);

      // Unmount all components
      unmount();

      await sleep(100);

      // Stream should be cleaned up
      expect(unsubscribeCallCount).toBeGreaterThan(0);
    });
  });
});
