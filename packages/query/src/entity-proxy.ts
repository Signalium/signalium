import type { Signal } from 'signalium';
import type { EntityRef } from './persistence.js';

export function createValueProxy(
  getNode: () => unknown,
  getEntityProxyByRef: (ref: EntityRef) => any,
  notifier: Signal<number>,
): any {
  const childCache = new Map<string, any>();

  const handler: ProxyHandler<object> = {
    get: (_target, prop) => {
      // subscribe on access
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      notifier.value;

      const key = String(prop);
      const current = getNode();

      if (key === 'length') {
        return Array.isArray(current) ? (current as unknown[]).length : undefined;
      }

      if (current === undefined || current === null) return undefined;

      let childValue: unknown;
      let childGetter: (() => unknown) | null = null;

      if (Array.isArray(current)) {
        const idx = Number.isInteger(Number(key)) ? Number(key) : NaN;
        if (Number.isNaN(idx)) return (current as any)[key];
        childGetter = () => (getNode() as unknown[])[idx];
        childValue = childGetter();
      } else if (typeof current === 'object') {
        childGetter = () => (getNode() as Record<string, unknown>)[key];
        childValue = childGetter();
      } else {
        return undefined;
      }

      const asRef = parseRef(childValue);
      if (asRef) {
        let cached = childCache.get(key);
        if (!cached) {
          cached = getEntityProxyByRef(asRef);
          childCache.set(key, cached);
        }
        return cached;
      }

      if (Array.isArray(childValue) || (childValue && typeof childValue === 'object')) {
        let cached = childCache.get(key);
        if (!cached) {
          cached = createValueProxy(childGetter!, getEntityProxyByRef, notifier);
          childCache.set(key, cached);
        }
        return cached;
      }

      return childValue;
    },
  };

  return new Proxy({}, handler);
}

function parseRef(value: unknown): EntityRef | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const maybe = value as { ref?: unknown };
    if (typeof maybe.ref === 'string') {
      const idx = maybe.ref.indexOf(':');
      if (idx > 0) {
        return { type: maybe.ref.slice(0, idx), id: maybe.ref.slice(idx + 1) };
      }
    }
  }
  return null;
}
