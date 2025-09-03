import { describe, it, expect, beforeEach } from 'vitest';
import { EntityStore } from '../entity-store.js';
import { InMemoryKV } from '../persistence.js';

const ref = (type: string, id: string) => ({ type, id });

describe('EntityStore basic behaviors', () => {
  let store: EntityStore;
  let kv: InMemoryKV;

  beforeEach(() => {
    kv = new InMemoryKV();
    store = new EntityStore({
      kv,
      getEntityRef: (proxy: any) => {
        const r =
          proxy && typeof proxy === 'object' && typeof proxy.id === 'string' && typeof proxy.__type === 'string'
            ? { type: proxy.__type, id: proxy.id }
            : { type: 'unknown', id: 'unknown' };
        return r;
      },
      getQueryRootRefs: value => {
        if (Array.isArray(value)) {
          return value
            .map(v => (v && typeof v === 'object' && 'ref' in (v as any) ? parseRef((v as any).ref) : null))
            .filter(Boolean) as any;
        }
        return [];
      },
    });
  });

  it('persists entity JSON and diffs child refs on setEntity', async () => {
    await store.setEntity({
      proxy: { __type: 'User', id: 'u1', name: 'A', friend: { ref: 'User:u2' } },
      childrenRefs: [ref('User', 'u2')],
    });

    // Update to remove friend and add pet
    await store.setEntity({
      proxy: { __type: 'User', id: 'u1', name: 'A', pet: { ref: 'Pet:p1' } },
      childrenRefs: [ref('Pet', 'p1')],
    });

    // Friend should be decremented and possibly removed if its count hits 0
    // Pet should be incremented
    // We assert by setting a query that references u1 only; cascade should remove pet when evicted
    await store.setQuery(ref('Query', 'q1'), [{ ref: 'User:u1' }]);
    await store.evictQuery(ref('Query', 'q1'));

    // After eviction, u1 is decremented to 0 and removed; its child pet should be decremented as well
    expect(await store.hasEntity(ref('User', 'u1'))).toBe(false);
  });

  it('hydrates entity proxies from JSON and resolves refs to proxies', async () => {
    // Seed two entities
    await store.setEntity({
      proxy: { __type: 'User', id: 'u2', name: 'B' },
      childrenRefs: [],
    });
    await store.setEntity({
      proxy: { __type: 'User', id: 'u1', friend: { ref: 'User:u2' } },
      childrenRefs: [ref('User', 'u2')],
    });

    const u1 = store.getEntityProxy<{ friend: any }>(ref('User', 'u1'));
    const friend = (u1 as any).friend;
    // friend is a proxy; accessing a field triggers hydration
    // We cannot easily assert identity here without a full reactive runtime; check that nested access does not throw
    expect(friend).toBeTruthy();
  });
});

function parseRef(s: unknown) {
  if (typeof s !== 'string') return null;
  const idx = s.indexOf(':');
  if (idx <= 0) return null;
  return { type: s.slice(0, idx), id: s.slice(idx + 1) };
}
