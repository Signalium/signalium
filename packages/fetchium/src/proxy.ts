import { createDefinitionProxy, DEFINITION_TARGET, CANCEL_PROXY } from './fieldRef.js';
import { PROXY_ID } from './proxyId.js';

export type WarnFn = (message: string, context?: Record<string, unknown>) => void;

const entries = Object.entries;
const isArray = Array.isArray;

/**
 * Base class for entity definitions. Users extend this to define entity shapes.
 * Also serves as the prototype for entity proxies, so `proxy instanceof Entity` works.
 */
export class Entity {
  static cache?: {
    gcTime?: number; // minutes - in-memory eviction time. Use 0 for next-tick, Infinity to never GC.
  };

  __subscribe?(onEvent: (event: import('./types.js').MutationEvent) => void): (() => void) | undefined;

  constructor() {
    return createDefinitionProxy(this);
  }
}

const ObjectProto = Object.prototype;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && Object.getPrototypeOf(v) === ObjectProto;
}

/**
 * Deep merge two objects, with the update object taking precedence.
 * Arrays and non-plain objects (Date, etc.) are replaced, not merged.
 * Only plain objects are recursively merged.
 */
export function mergeValues<T extends Record<string, unknown>>(
  target: Record<string, unknown>,
  update: Record<string, unknown>,
): T {
  for (const [key, value] of entries(update)) {
    const targetValue = target[key];
    if (isPlainObject(value) && !PROXY_ID.has(value) && isPlainObject(targetValue) && !PROXY_ID.has(targetValue)) {
      mergeValues(targetValue, value);
    } else {
      target[key] = value;
    }
  }

  return target as T;
}

export { PROXY_ID, getProxyId } from './proxyId.js';
