import { describe, it, expect } from 'vitest';
import { t } from '../../typeDefs.js';
import { Entity, parseValue } from '../../proxy.js';
import { Query, getQuery } from '../../query.js';
import { parseEntities } from '../../parseEntities.js';
import { setupParsingTests, testWithClient, getEntityKey, getDocument, getShapeKey } from './test-utils.js';

/**
 * t.const Tests
 *
 * Tests for constant type parsing across:
 * - Direct parseValue usage
 * - Query integration
 * - Entity integration
 * - Container types (object, array, record, union)
 */

describe('t.const', () => {
  describe('Direct parseValue', () => {
    describe('basic parsing', () => {
      it('should parse matching string constant', () => {
        expect(parseValue('active', t.const('active'), 'test')).toBe('active');
      });

      it('should parse matching number constant', () => {
        expect(parseValue(42, t.const(42), 'test')).toBe(42);
      });

      it('should parse matching boolean constant', () => {
        expect(parseValue(true, t.const(true), 'test')).toBe(true);
        expect(parseValue(false, t.const(false), 'test')).toBe(false);
      });

      it('should throw for non-matching constant values', () => {
        expect(() => parseValue('inactive', t.const('active'), 'test')).toThrow('expected "active"');
        expect(() => parseValue(43, t.const(42), 'test')).toThrow('expected 42');
        expect(() => parseValue(false, t.const(true), 'test')).toThrow('expected true');
      });

      it('should throw for wrong types', () => {
        expect(() => parseValue(42, t.const('42'), 'test')).toThrow();
        expect(() => parseValue('true', t.const(true), 'test')).toThrow();
      });
    });

    describe('within object', () => {
      it('should parse constant fields in objects', () => {
        const objType = t.object({ type: t.const('user'), status: t.const('active') });
        const result = parseValue({ type: 'user', status: 'active' }, objType, 'test') as {
          type: string;
          status: string;
        };

        expect(result.type).toBe('user');
        expect(result.status).toBe('active');
      });

      it('should throw for wrong constant value in object', () => {
        const objType = t.object({ type: t.const('user') });

        expect(() => parseValue({ type: 'admin' }, objType, 'test')).toThrow('expected "user"');
      });
    });

    describe('within array', () => {
      it('should parse array of constants', () => {
        const result = parseValue(['yes', 'yes', 'yes'], t.array(t.const('yes')), 'test');
        expect(result).toEqual(['yes', 'yes', 'yes']);
      });

      it('should filter non-matching constants in array', () => {
        const result = parseValue(['yes', 'no', 'yes'], t.array(t.const('yes')), 'test', false, () => {});
        expect(result).toEqual(['yes', 'yes']);
      });
    });

    describe('within record', () => {
      it('should parse record of constants', () => {
        const result = parseValue({ a: 'active', b: 'active' }, t.record(t.const('active')), 'test');
        expect(result).toEqual({ a: 'active', b: 'active' });
      });

      it('should throw for non-matching constant in record', () => {
        expect(() => parseValue({ a: 'active', b: 'inactive' }, t.record(t.const('active')), 'test')).toThrow(
          'expected "active"',
        );
      });
    });

    describe('within union', () => {
      it('should parse constant in union', () => {
        const unionType = t.union(t.const('active'), t.const('inactive'), t.const('pending'));
        expect(parseValue('active', unionType, 'test')).toBe('active');
        expect(parseValue('inactive', unionType, 'test')).toBe('inactive');
        expect(parseValue('pending', unionType, 'test')).toBe('pending');
      });

      it('should throw for value not in constant union', () => {
        const unionType = t.union(t.const('active'), t.const('inactive'));
        expect(() => parseValue('unknown', unionType, 'test')).toThrow();
      });

      it('should parse mixed constant union', () => {
        const unionType = t.union(t.const('enabled'), t.const(1), t.const(true));
        expect(parseValue('enabled', unionType, 'test')).toBe('enabled');
        expect(parseValue(1, unionType, 'test')).toBe(1);
        expect(parseValue(true, unionType, 'test')).toBe(true);
      });
    });

    describe('edge cases', () => {
      it('should show correct error path', () => {
        expect(() => parseValue('admin', t.const('user'), 'GET:/config.type')).toThrow(
          'Validation error at GET:/config.type: expected "user", got string',
        );
      });

      it('should handle empty string constant', () => {
        expect(parseValue('', t.const(''), 'test')).toBe('');
        expect(() => parseValue('nonempty', t.const(''), 'test')).toThrow('expected ""');
      });

      it('should handle zero constant', () => {
        expect(parseValue(0, t.const(0), 'test')).toBe(0);
        expect(() => parseValue(1, t.const(0), 'test')).toThrow('expected 0');
      });
    });
  });

  describe('Query integration', () => {
    const getContext = setupParsingTests();

    describe('basic usage', () => {
      it('should parse string constant in query response', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/item', { type: 'user', status: 'active' });

        await testWithClient(client, async () => {
          class GetItem extends Query {
            path = '/item';
            response = {
              type: t.const('user'),
              status: t.const('active'),
            };
          }

          const relay = getQuery(GetItem);
          const result = await relay;

          expect(result.type).toBe('user');
          expect(result.status).toBe('active');
        });
      });

      it('should parse number constant in query response', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/version', { version: 1 });

        await testWithClient(client, async () => {
          class GetVersion extends Query {
            path = '/version';
            response = { version: t.const(1) };
          }

          const relay = getQuery(GetVersion);
          const result = await relay;

          expect(result.version).toBe(1);
        });
      });
    });

    describe('within object', () => {
      it('should parse constant in nested object', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/data', {
          config: { mode: 'production' },
        });

        await testWithClient(client, async () => {
          class GetData extends Query {
            path = '/data';
            response = {
              config: t.object({
                mode: t.const('production'),
              }),
            };
          }

          const relay = getQuery(GetData);
          const result = await relay;

          expect(result.config.mode).toBe('production');
        });
      });
    });

    describe('within array', () => {
      it('should parse array of constants', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/flags', { flags: ['enabled', 'enabled', 'enabled'] });

        await testWithClient(client, async () => {
          class GetFlags extends Query {
            path = '/flags';
            response = { flags: t.array(t.const('enabled')) };
          }

          const relay = getQuery(GetFlags);
          const result = await relay;

          expect(result.flags).toEqual(['enabled', 'enabled', 'enabled']);
        });
      });
    });

    describe('within record', () => {
      it('should parse record of constants', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/statuses', {
          statuses: { a: 'ok', b: 'ok' },
        });

        await testWithClient(client, async () => {
          class GetStatuses extends Query {
            path = '/statuses';
            response = { statuses: t.record(t.const('ok')) };
          }

          const relay = getQuery(GetStatuses);
          const result = await relay;

          expect(result.statuses.a).toBe('ok');
          expect(result.statuses.b).toBe('ok');
        });
      });
    });

    describe('within union', () => {
      it('should parse constant union in query', async () => {
        const { client, mockFetch } = getContext();
        mockFetch.get('/status', { status: 'pending' });

        await testWithClient(client, async () => {
          class GetStatus extends Query {
            path = '/status';
            response = {
              status: t.union(t.const('active'), t.const('inactive'), t.const('pending')),
            };
          }

          const relay = getQuery(GetStatus);
          const result = await relay;

          expect(result.status).toBe('pending');
        });
      });
    });
  });

  describe('Entity integration', () => {
    const getContext = setupParsingTests();

    describe('basic usage', () => {
      it('should parse constant field in entity', async () => {
        const { client, kv } = getContext();

        class Feature extends Entity {
          __typename = t.typename('Feature');
          id = t.id;
          status = t.const('enabled');
        }

        const QueryResult = t.object({ feature: t.entity(Feature) });

        const result = {
          feature: { __typename: 'Feature', id: 1, status: 'enabled' },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Feature', 1, getShapeKey(t.entity(Feature)));
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).status).toBe('enabled');
      });
    });

    describe('within object', () => {
      it('should parse constant in nested object within entity', async () => {
        const { client, kv } = getContext();

        class Settings extends Entity {
          __typename = t.typename('Settings');
          id = t.id;
          config = t.object({
            mode: t.const('dark'),
          });
        }

        const QueryResult = t.object({ settings: t.entity(Settings) });

        const result = {
          settings: {
            __typename: 'Settings',
            id: 1,
            config: { mode: 'dark' },
          },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Settings', 1, getShapeKey(t.entity(Settings)));
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).config.mode).toBe('dark');
      });
    });

    describe('within array', () => {
      it('should parse constant array in entity', async () => {
        const { client, kv } = getContext();

        class Config extends Entity {
          __typename = t.typename('Config');
          id = t.id;
          flags = t.array(t.const('on'));
        }

        const QueryResult = t.object({ config: t.entity(Config) });

        const result = {
          config: {
            __typename: 'Config',
            id: 1,
            flags: ['on', 'on'],
          },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Config', 1, getShapeKey(t.entity(Config)));
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).flags).toEqual(['on', 'on']);
      });
    });

    describe('within record', () => {
      it('should parse constant record in entity', async () => {
        const { client, kv } = getContext();

        class Status extends Entity {
          __typename = t.typename('Status');
          id = t.id;
          checks = t.record(t.const('passed'));
        }

        const QueryResult = t.object({ status: t.entity(Status) });

        const result = {
          status: {
            __typename: 'Status',
            id: 1,
            checks: { health: 'passed', memory: 'passed' },
          },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Status', 1, getShapeKey(t.entity(Status)));
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).checks).toEqual({ health: 'passed', memory: 'passed' });
      });
    });

    describe('within union', () => {
      it('should parse constant in union field of entity', async () => {
        const { client, kv } = getContext();

        class Toggle extends Entity {
          __typename = t.typename('Toggle');
          id = t.id;
          state = t.union(t.const('on'), t.const('off'));
        }

        const QueryResult = t.object({ toggle: t.entity(Toggle) });

        const result = {
          toggle: {
            __typename: 'Toggle',
            id: 1,
            state: 'on',
          },
        };

        const entityRefs = new Set<number>();
        await parseEntities(result, QueryResult, client, entityRefs);

        const key = getEntityKey('Toggle', 1, getShapeKey(t.entity(Toggle)));
        const doc = await getDocument(kv, key);

        expect(doc).toBeDefined();
        expect((doc as any).state).toBe('on');
      });
    });
  });
});
