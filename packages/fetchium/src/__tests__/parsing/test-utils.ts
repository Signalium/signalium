import { beforeEach, afterEach } from 'vitest';
import { hashValue } from 'signalium/utils';
import { MemoryPersistentStore, SyncQueryStore } from '../../stores/sync.js';
import { QueryClient } from '../../QueryClient.js';
import { valueKeyFor, refIdsKeyFor, refCountKeyFor } from '../../stores/shared.js';
import type { EntityInstance } from '../../EntityInstance.js';
import type { PreloadedEntityMap } from '../../QueryClient.js';
import type { TypeDef, ComplexTypeDef, EntityDef } from '../../types.js';
// Import and re-export commonly used utilities from the main utils file
import { createMockFetch, testWithClient, watchOnce, sleep } from '../utils.js';
export { createMockFetch, testWithClient, watchOnce, sleep };
export { parseValue } from '../../parseEntities.js';

/**
 * Test wrapper: parse + apply + collect refs.
 */
export function parseEntities(
  value: unknown,
  typeDef: TypeDef | ComplexTypeDef,
  queryClient: QueryClient,
  entityRefs?: Map<EntityInstance, number>,
  preloadedEntities?: PreloadedEntityMap,
): unknown {
  const persist = preloadedEntities === undefined;
  const parsed = queryClient.parseData(value, typeDef as any, preloadedEntities);
  const result = queryClient.applyRefs(parsed, persist);

  if (entityRefs !== undefined) {
    for (const [inst, count] of result.entityRefs) {
      entityRefs.set(inst, count);
    }
  }

  return result.data;
}

/**
 * Test wrapper for single entity: parse + apply.
 */
export function parseEntity(
  obj: Record<string, unknown>,
  entityShape: EntityDef,
  queryClient: QueryClient,
  entityRefs?: Map<EntityInstance, number>,
): unknown {
  const parsed = queryClient.parseData(obj, entityShape as any);
  const result = queryClient.applyRefs(parsed, true);

  if (entityRefs !== undefined) {
    for (const [inst, count] of result.entityRefs) {
      entityRefs.set(inst, count);
    }
  }

  return result.data;
}

/**
 * Helper to get a document from the kv store for testing
 */
export async function getDocument(kv: MemoryPersistentStore, key: number): Promise<unknown | undefined> {
  const value = kv.getString(valueKeyFor(key));
  return value ? JSON.parse(value) : undefined;
}

/**
 * Helper to get the entity key from typename and id.
 */
export function getEntityKey(typename: string, id: unknown): number {
  return hashValue([typename, id]);
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
