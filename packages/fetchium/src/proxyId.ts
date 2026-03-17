/**
 * WeakMap that brands entity proxies with their numeric key.
 * Shared between EntityInstance (writes) and proxy.ts (reads for
 * parseObjectValue / mergeValues identity checks).
 */
export const PROXY_ID = new WeakMap<object, number>();

export function getProxyId(object: Record<string, unknown>): number | undefined {
  return PROXY_ID.get(object);
}
