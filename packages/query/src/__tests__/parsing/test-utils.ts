import { beforeEach, afterEach } from 'vitest';
import { hashValue } from 'signalium/utils';
import { MemoryPersistentStore, SyncQueryStore } from '../../stores/sync.js';
import { QueryClient } from '../../QueryClient.js';
import { valueKeyFor, refIdsKeyFor, refCountKeyFor } from '../../stores/shared.js';

// Import and re-export commonly used utilities from the main utils file
import { createMockFetch, testWithClient, watchOnce, sleep } from '../utils.js';
export { createMockFetch, testWithClient, watchOnce, sleep };

/**
 * Helper to get a document from the kv store for testing
 */
export async function getDocument(kv: MemoryPersistentStore, key: number): Promise<unknown | undefined> {
  const value = kv.getString(valueKeyFor(key));
  return value ? JSON.parse(value) : undefined;
}

/**
 * Helper to get the entity key from typename and id
 */
export function getEntityKey(typename: string, id: string | number): number {
  return hashValue(`${typename}:${id}`);
}

/**
 * Helper to get entity refs from the kv store
 */
export async function getEntityRefs(kv: MemoryPersistentStore, key: number): Promise<number[] | undefined> {
  const buffer = await kv.getBuffer(refIdsKeyFor(key));
  return buffer ? Array.from(buffer) : undefined;
}

/**
 * Helper to get entity ref count from the kv store
 */
export async function getEntityRefCount(kv: MemoryPersistentStore, key: number): Promise<number | undefined> {
  return kv.getNumber(refCountKeyFor(key));
}

/**
 * Test context that provides client, store, and kv for parsing tests
 */
export interface ParsingTestContext {
  client: QueryClient;
  store: SyncQueryStore;
  kv: MemoryPersistentStore;
  mockFetch: ReturnType<typeof createMockFetch>;
}

/**
 * Creates a fresh test context for parsing tests.
 * Call this in beforeEach and destroy in afterEach.
 */
export function createParsingTestContext(): ParsingTestContext {
  const kv = new MemoryPersistentStore();
  const store = new SyncQueryStore(kv);
  const mockFetch = createMockFetch();
  const client = new QueryClient(store, { fetch: mockFetch as any });

  return { client, store, kv, mockFetch };
}

/**
 * Helper hook for setting up and tearing down parsing test context.
 * Returns a getter function that provides the current context.
 *
 * @example
 * const getContext = setupParsingTests();
 *
 * it('should parse value', async () => {
 *   const { client, mockFetch } = getContext();
 *   // ... test code
 * });
 */
export function setupParsingTests(): () => ParsingTestContext {
  let ctx: ParsingTestContext;

  beforeEach(() => {
    ctx = createParsingTestContext();
  });

  afterEach(() => {
    ctx?.client?.destroy();
  });

  return () => ctx;
}
