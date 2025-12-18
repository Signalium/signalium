import { watchOnce, watcher, withContexts } from 'signalium';
import { QueryClient, QueryClientContext, QueryStore } from '../QueryClient.js';
import { EntityStore } from '../EntityMap.js';

// Re-export watchOnce for convenience
export { watchOnce };

interface MockFetchOptions {
  status?: number;
  headers?: Record<string, string>;
  delay?: number;
  error?: Error;
  jsonError?: Error;
}

interface MockFetch {
  (url: string, options?: RequestInit): Promise<Response>;

  get(url: string, response: unknown, opts?: MockFetchOptions): void;
  post(url: string, response: unknown, opts?: MockFetchOptions): void;
  put(url: string, response: unknown, opts?: MockFetchOptions): void;
  delete(url: string, response: unknown, opts?: MockFetchOptions): void;
  patch(url: string, response: unknown, opts?: MockFetchOptions): void;

  reset(): void;
  calls: Array<{ url: string; options: RequestInit }>;
}

interface MockRoute {
  url: string;
  method: string;
  response: unknown;
  options: MockFetchOptions;
  used: boolean;
}

/**
 * Creates a mock fetch function with a fluent API for setting up responses.
 *
 * @example
 * const fetch = createMockFetch();
 * fetch.get('/users/123', { id: 123, name: 'Alice' });
 * fetch.post('/users', { id: 456, name: 'Bob' }, { status: 201 });
 *
 * const response = await fetch('/users/123', { method: 'GET' });
 * const data = await response.json(); // { id: 123, name: 'Alice' }
 */
export function createMockFetch(): MockFetch {
  const routes: MockRoute[] = [];
  const calls: Array<{ url: string; options: RequestInit }> = [];

  const matchRoute = (url: string, method: string): MockRoute | undefined => {
    const isMatch = (r: MockRoute): boolean => {
      if (r.method !== method) return false;

      // Simple pattern: check if the route URL is a prefix or matches the base path
      const routeBase = r.url.split('?')[0];
      const urlBase = url.split('?')[0];

      // Check if URL starts with the route (for exact matches)
      if (urlBase === routeBase) return true;

      // Check if route contains path params [...]
      if (r.url.includes('[')) {
        const routeParts = routeBase.split('/');
        const urlParts = urlBase.split('/');

        if (routeParts.length !== urlParts.length) return false;

        return routeParts.every((part, i) => {
          if (part.startsWith('[') && part.endsWith(']')) return true;
          return part === urlParts[i];
        });
      }

      return false;
    };

    // First try to find an unused match
    const unusedMatch = routes.find(r => !r.used && isMatch(r));
    if (unusedMatch) return unusedMatch;

    // If no unused matches, reuse the last matching route
    for (let i = routes.length - 1; i >= 0; i--) {
      if (isMatch(routes[i])) {
        return routes[i];
      }
    }

    return undefined;
  };

  const mockFetch = async (url: string, options: RequestInit = {}): Promise<Response> => {
    const method = (options.method || 'GET').toUpperCase();

    calls.push({ url, options });

    const route = matchRoute(url, method);

    if (!route) {
      throw new Error(
        `No mock response configured for ${method} ${url}\n` +
          `Available routes:\n${routes.map(r => `  ${r.method} ${r.url}`).join('\n')}`,
      );
    }

    route.used = true;

    if (route.options.delay) {
      await new Promise(resolve => setTimeout(resolve, route.options.delay));
    }

    if (route.options.error) {
      throw route.options.error;
    }

    const status = route.options.status ?? 200;
    const headers = route.options.headers ?? {};

    // Resolve response if it's a function
    const resolveResponse = async () => {
      if (typeof route.response === 'function') {
        return await route.response();
      }

      // Deep clone the response to avoid mutating the original object
      return JSON.parse(JSON.stringify(route.response));
    };

    // Create a mock Response object
    const response = {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : status === 201 ? 'Created' : status === 204 ? 'No Content' : 'Error',
      headers: new Headers(headers),
      json: async () => {
        if (route.options.jsonError) {
          throw route.options.jsonError;
        }
        return await resolveResponse();
      },
      text: async () => JSON.stringify(await resolveResponse()),
      blob: async () => new Blob([JSON.stringify(await resolveResponse())]),
      arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(await resolveResponse())).buffer,
      clone: () => response,
    } as Response;

    return response;
  };

  const addRoute = (method: string, url: string, response: unknown, opts: MockFetchOptions = {}) => {
    routes.push({
      url,
      method: method.toUpperCase(),
      response,
      options: opts,
      used: false,
    });
  };

  mockFetch.get = (url: string, response: unknown, opts?: MockFetchOptions) => {
    addRoute('GET', url, response, opts);
  };

  mockFetch.post = (url: string, response: unknown, opts?: MockFetchOptions) => {
    addRoute('POST', url, response, opts);
  };

  mockFetch.put = (url: string, response: unknown, opts?: MockFetchOptions) => {
    addRoute('PUT', url, response, opts);
  };

  mockFetch.delete = (url: string, response: unknown, opts?: MockFetchOptions) => {
    addRoute('DELETE', url, response, opts);
  };

  mockFetch.patch = (url: string, response: unknown, opts?: MockFetchOptions) => {
    addRoute('PATCH', url, response, opts);
  };

  mockFetch.reset = () => {
    routes.length = 0;
    calls.length = 0;
  };

  mockFetch.calls = calls;

  return mockFetch as MockFetch;
}

/**
 * Creates a test watcher that tracks all values emitted by a reactive function.
 * Returns an object with the values array and an unsubscribe function.
 *
 * Note: This creates a continuous watcher. For one-time execution, use `watchOnce` instead.
 */
export function createTestWatcher<T>(fn: () => T): {
  values: T[];
  unsub: () => void;
} {
  const values: T[] = [];

  const w = watcher(() => {
    const value = fn();
    values.push(value);
  });

  const unsub = w.addListener(() => {});

  return { values, unsub };
}

/**
 * Test helper that combines query client context injection and automatic watcher cleanup.
 * Wraps the test in a watcher and awaits it, keeping relays active during the test.
 *
 * @example
 * await testWithClient(client, async () => {
 *   const relay = getItem({ id: '1' });
 *   await relay;
 *   expect(relay.value).toBeDefined();
 *   // Watcher is automatically cleaned up
 * });
 */
export async function testWithClient(client: QueryClient, fn: () => Promise<void>): Promise<void> {
  return withContexts([[QueryClientContext, client]], () => watchOnce(fn));
}

export const sleep = (ms: number = 0) =>
  new Promise(resolve => {
    setTimeout(() => {
      resolve(true);
    }, ms);
  });

/**
 * Test helper to access the internal store of a QueryClient.
 * Uses bracket notation to bypass TypeScript access checks.
 */
export function getClientStore(client: QueryClient): QueryStore {
  return client['store'];
}

/**
 * Test helper to access the internal entity map of a QueryClient.
 * Uses bracket notation to bypass TypeScript access checks.
 */
export function getClientEntityMap(client: QueryClient): EntityStore {
  return client['entityMap'];
}

/**
 * Test helper to get the size of the entity map.
 * EntityStore doesn't expose a size property, so we access the internal map.
 */
export function getEntityMapSize(client: QueryClient): number {
  const entityMap = getClientEntityMap(client);
  return entityMap['map'].size;
}

/**
 * Helper to send a stream update outside the reactive context.
 * This avoids "signal dirtied after consumed" errors.
 */
export async function sendStreamUpdate(callback: ((update: any) => void) | undefined, update: any): Promise<void> {
  if (callback === undefined) {
    throw new Error('Update is undefined');
  }

  await new Promise<void>(resolve => {
    setTimeout(() => {
      callback(update);
      resolve();
    }, 0);
  });
  // Give time for update to propagate
  await sleep(10);
}
