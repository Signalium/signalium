import { describe, it, expect, beforeEach } from 'vitest';
import { EntityStore } from '../entity-store.js';
import { InMemoryKV } from '../persistence.js';
import { parseAndStoreQuery } from '../parser.js';

const ref = (type: string, id: string) => ({ type, id });

class SimpleValidator<T> {
  constructor(public parseFn: (value: unknown) => T) {}
  parse = (value: unknown) => this.parseFn(value);
}

describe('Parser integration', () => {
  let store: EntityStore;
  let kv: InMemoryKV;

  beforeEach(() => {
    kv = new InMemoryKV();
    store = new EntityStore({
      kv,
      getEntityRef: (proxy: any) => {
        return { type: proxy.__type, id: proxy.id };
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

  it('parses and stores entities and query roots', async () => {
    const validator = new SimpleValidator<any>(v => v as any);
    const payload = [{ ref: 'User:u1' }];

    await parseAndStoreQuery(ref('Query', 'q1'), validator as any, payload, {
      store,
      config: {
        getEntityRef: (entity: any) => ({ type: entity.__type, id: entity.id }),
      },
    });

    expect(await store.hasQuery(ref('Query', 'q1'))).toBe(true);
  });
});

function parseRef(s: unknown) {
  if (typeof s !== 'string') return null;
  const idx = s.indexOf(':');
  if (idx <= 0) return null;
  return { type: s.slice(0, idx), id: s.slice(idx + 1) };
}
