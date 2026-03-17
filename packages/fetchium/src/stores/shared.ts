// Query Instance keys
export const valueKeyFor = (id: number) => `sq:doc:value:${id}`;
export const refCountKeyFor = (id: number) => `sq:doc:refCount:${id}`;
export const refIdsKeyFor = (id: number) => `sq:doc:refIds:${id}`;
export const updatedAtKeyFor = (id: number) => `sq:doc:updatedAt:${id}`;
// Query Type keys
export const queueKeyFor = (queryDefId: string) => `sq:doc:queue:${queryDefId}`;
// Query Type metadata keys (used for stale cache cleanup)
export const lastUsedKeyFor = (queryDefId: string) => `sq:doc:lastUsed:${queryDefId}`;
export const cacheTimeKeyFor = (queryDefId: string) => `sq:doc:cacheTime:${queryDefId}`;

export const LAST_USED_PREFIX = 'sq:doc:lastUsed:';

// Default values
export const DEFAULT_MAX_COUNT = 50;
export const DEFAULT_CACHE_TIME = 60 * 24; // 24 hours in minutes
export const DEFAULT_GC_TIME = 5; // 5 minutes - in-memory eviction default
