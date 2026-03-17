// Query Instance keys
export const valueKeyFor = (id: number) => `sq:doc:value:${id}`;
export const refCountKeyFor = (id: number) => `sq:doc:refCount:${id}`;
export const refIdsKeyFor = (id: number) => `sq:doc:refIds:${id}`;
export const updatedAtKeyFor = (id: number) => `sq:doc:updatedAt:${id}`;
// Query Type keys
export const queueKeyFor = (queryDefId: string) => `sq:doc:queue:${queryDefId}`;

// Default values
export const DEFAULT_MAX_COUNT = 50;
export const DEFAULT_CACHE_TIME = 60 * 24; // 24 hours in minutes
export const DEFAULT_GC_TIME = 5; // 5 minutes - in-memory eviction default
