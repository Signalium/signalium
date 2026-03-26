import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { reactive } from 'signalium';
import { SyncQueryStore, MemoryPersistentStore } from '../stores/sync.js';
import { QueryClient } from '../QueryClient.js';
import { t } from '../typeDefs.js';
import { Entity } from '../proxy.js';
import { Query, fetchQuery } from '../query.js';
import { RESTMutation, getMutation } from '../mutation.js';
import { reifyValue } from '../fieldRef.js';
import { createMockFetch, testWithClient, sleep, getEntityMapSize } from './utils.js';
import type { MutationEvent } from '../types.js';
import type { LoadNextConfig } from '../query-types.js';

// ============================================================
// StreamAPI interface
// ============================================================

interface StreamAPI {
  waitForSubscription(signal?: AbortSignal): Promise<{ topics: string[] }>;
  waitForTopicData(topic: string, signal?: AbortSignal): Promise<{ data: unknown; loadNextUrl?: string }>;
  getTopicMeta(topic: string): { loadNextUrl?: string } | undefined;
  onTopicUpdate(topic: string, callback: (event: MutationEvent) => void): () => void;
}

// ============================================================
// MockStream
// ============================================================

class MockStream implements StreamAPI {
  private _subscribedTopics: string[] | undefined = undefined;
  private _subscriptionResolvers: Array<(result: { topics: string[] }) => void> = [];
  private _topicDataBuffer = new Map<string, Array<{ data: unknown; loadNextUrl?: string }>>();
  private _topicDataResolvers = new Map<string, Array<(result: { data: unknown; loadNextUrl?: string }) => void>>();
  private _topicMeta = new Map<string, { loadNextUrl?: string }>();
  private _updateListeners = new Map<string, Set<(event: MutationEvent) => void>>();

  pushSubscribed(topics: string[]): void {
    this._subscribedTopics = topics;
    for (const resolve of this._subscriptionResolvers) {
      resolve({ topics });
    }
    this._subscriptionResolvers = [];
  }

  pushTopicData(topic: string, data: unknown, meta?: { loadNextUrl?: string }): void {
    if (meta) this._topicMeta.set(topic, meta);

    const resolvers = this._topicDataResolvers.get(topic);
    if (resolvers && resolvers.length > 0) {
      const resolve = resolvers.shift()!;
      resolve({ data, loadNextUrl: meta?.loadNextUrl });
    } else {
      if (!this._topicDataBuffer.has(topic)) {
        this._topicDataBuffer.set(topic, []);
      }
      this._topicDataBuffer.get(topic)!.push({ data, loadNextUrl: meta?.loadNextUrl });
    }
  }

  pushUpdate(topic: string, event: MutationEvent): void {
    const listeners = this._updateListeners.get(topic);
    if (listeners) {
      for (const listener of listeners) {
        listener(event);
      }
    }
  }

  waitForSubscription(_signal?: AbortSignal): Promise<{ topics: string[] }> {
    if (this._subscribedTopics !== undefined) {
      return Promise.resolve({ topics: this._subscribedTopics });
    }
    return new Promise(resolve => {
      this._subscriptionResolvers.push(resolve);
    });
  }

  waitForTopicData(topic: string, _signal?: AbortSignal): Promise<{ data: unknown; loadNextUrl?: string }> {
    const buffered = this._topicDataBuffer.get(topic);
    if (buffered && buffered.length > 0) {
      return Promise.resolve(buffered.shift()!);
    }
    return new Promise(resolve => {
      if (!this._topicDataResolvers.has(topic)) {
        this._topicDataResolvers.set(topic, []);
      }
      this._topicDataResolvers.get(topic)!.push(resolve);
    });
  }

  getTopicMeta(topic: string): { loadNextUrl?: string } | undefined {
    return this._topicMeta.get(topic);
  }

  onTopicUpdate(topic: string, callback: (event: MutationEvent) => void): () => void {
    if (!this._updateListeners.has(topic)) {
      this._updateListeners.set(topic, new Set());
    }
    this._updateListeners.get(topic)!.add(callback);
    return () => {
      this._updateListeners.get(topic)?.delete(callback);
    };
  }

  reset(): void {
    this._subscribedTopics = undefined;
    this._subscriptionResolvers = [];
    this._topicDataBuffer.clear();
    this._topicDataResolvers.clear();
    this._topicMeta.clear();
    this._updateListeners.clear();
  }
}

// ============================================================
// TopicNotFoundError
// ============================================================

class TopicNotFoundError extends Error {
  constructor(topic: string) {
    super(`Topic "${topic}" not found in subscription`);
    this.name = 'TopicNotFoundError';
  }
}

// ============================================================
// TopicQuery base class
// ============================================================

abstract class TopicQuery extends Query {
  declare topic: string;
  loadNext?: LoadNextConfig;

  getLoadNext?(): LoadNextConfig | undefined;

  getStorageKey(): string {
    return `topic:${this.topic}`;
  }

  async send(): Promise<unknown> {
    const stream = (this.context as any).stream as StreamAPI;
    if (!stream) {
      throw new Error('StreamAPI not available in context');
    }

    const { topics } = await stream.waitForSubscription(this.signal);

    if (!topics.includes(this.topic)) {
      throw new TopicNotFoundError(this.topic);
    }

    const result = await stream.waitForTopicData(this.topic, this.signal);
    return result.data;
  }

  private resolveLoadNext(): { url?: string; searchParams?: Record<string, unknown> } | undefined {
    const dynamicConfig = this.getLoadNext ? this.getLoadNext() : undefined;
    const loadNextConfig = dynamicConfig ?? this.rawLoadNext;
    if (loadNextConfig === undefined) return undefined;

    const resolveRoot: Record<string, unknown> = {
      params: this.params ?? {},
      result: this.resultData,
    };

    return {
      url: loadNextConfig.url !== undefined ? (reifyValue(loadNextConfig.url, resolveRoot) as string) : undefined,
      searchParams:
        loadNextConfig.searchParams !== undefined
          ? (reifyValue(loadNextConfig.searchParams, resolveRoot) as Record<string, unknown>)
          : undefined,
    };
  }

  hasNext(): boolean {
    const stream = (this.context as any)?.stream as StreamAPI | undefined;
    const meta = stream?.getTopicMeta?.(this.topic);
    if (!meta?.loadNextUrl) return false;

    const resolved = this.resolveLoadNext();
    if (resolved === undefined) return false;

    if (resolved.searchParams !== undefined) {
      const keys = Object.keys(resolved.searchParams);
      if (keys.length === 0) return false;
      for (const key of keys) {
        if (resolved.searchParams[key] === undefined || resolved.searchParams[key] === null) return false;
      }
    }

    return true;
  }

  async sendNext(): Promise<unknown> {
    const stream = (this.context as any).stream as StreamAPI;
    const meta = stream.getTopicMeta(this.topic);

    if (!meta?.loadNextUrl) {
      throw new Error('No loadNextUrl available for topic');
    }

    const resolved = this.resolveLoadNext();
    if (resolved === undefined) {
      throw new Error('loadNext is not configured for this query');
    }

    let url = meta.loadNextUrl;

    if (resolved.searchParams) {
      const sp = new URLSearchParams();
      for (const key in resolved.searchParams) {
        const val = resolved.searchParams[key];
        if (val !== undefined && val !== null) {
          sp.append(key, String(val));
        }
      }
      const qs = sp.toString();
      if (qs) {
        url += (url.includes('?') ? '&' : '?') + qs;
      }
    }

    const fetchResponse = await this.context.fetch(url, {
      signal: this.signal,
    });

    this.response = fetchResponse;
    return fetchResponse.json();
  }

  getConfig() {
    const stream = (this.context as any)?.stream as StreamAPI | undefined;
    return {
      retry: false as const,
      subscribe: stream
        ? (onEvent: (event: MutationEvent) => void) => {
            return stream.onTopicUpdate(this.topic, onEvent);
          }
        : undefined,
    };
  }
}

// ============================================================
// Test entities
// ============================================================

class TopicBalance extends Entity {
  __typename = t.typename('TopicBalance');
  id = t.id;
  walletId = t.string;
  token = t.string;
  amount = t.number;
}

class TopicPrice extends Entity {
  __typename = t.typename('TopicPrice');
  id = t.id;
  token = t.string;
  value = t.number;
  change24h = t.number;
}

class TopicPosition extends Entity {
  __typename = t.typename('TopicPosition');
  id = t.id;
  walletId = t.string;
  token = t.string;
  size = t.number;
  entryPrice = t.number;
}

class TopicWallet extends Entity {
  __typename = t.typename('TopicWallet');
  id = t.id;
  name = t.string;
  totalValue = t.number;
}

// ============================================================
// Test helpers
// ============================================================

async function pushUpdateOutsideReactiveContext(
  stream: MockStream,
  topic: string,
  event: MutationEvent,
): Promise<void> {
  await new Promise<void>(resolve => {
    setTimeout(() => {
      stream.pushUpdate(topic, event);
      resolve();
    }, 0);
  });
  await sleep(10);
}

async function applyEventOutsideReactiveContext(client: QueryClient, event: MutationEvent): Promise<void> {
  await new Promise<void>(resolve => {
    setTimeout(() => {
      client.applyMutationEvent(event);
      resolve();
    }, 0);
  });
  await sleep(10);
}

// ============================================================
// Tests
// ============================================================

describe('TopicQuery', () => {
  let client: QueryClient;
  let mockFetch: ReturnType<typeof createMockFetch>;
  let mockStream: MockStream;

  beforeEach(() => {
    const kv = new MemoryPersistentStore();
    const store = new SyncQueryStore(kv);
    mockFetch = createMockFetch();
    mockStream = new MockStream();
    client = new QueryClient(store, { fetch: mockFetch, stream: mockStream } as any);
  });

  afterEach(() => {
    client?.destroy();
  });

  // ============================================================
  // Section 1: Basic Topic Loading
  // ============================================================

  describe('Basic Topic Loading', () => {
    it('should be pending before subscription event', async () => {
      class GetPrices extends TopicQuery {
        topic = 'prices:live';
        result = {
          items: t.array(t.entity(TopicPrice)),
        };
      }

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetPrices);
        expect(relay.isPending).toBe(true);

        mockStream.pushSubscribed(['prices:live']);
        mockStream.pushTopicData('prices:live', {
          items: [{ __typename: 'TopicPrice', id: '1', token: 'BTC', value: 50000, change24h: 2.5 }],
        });

        await relay;
        expect(relay.isResolved).toBe(true);
      });
    });

    it('should resolve when subscribed event contains topic and data arrives', async () => {
      class GetPrices extends TopicQuery {
        topic = 'prices:live';
        result = {
          items: t.array(t.entity(TopicPrice)),
        };
      }

      mockStream.pushSubscribed(['prices:live', 'balances:wallet-1']);
      mockStream.pushTopicData('prices:live', {
        items: [
          { __typename: 'TopicPrice', id: '1', token: 'BTC', value: 50000, change24h: 2.5 },
          { __typename: 'TopicPrice', id: '2', token: 'ETH', value: 3000, change24h: -1.2 },
        ],
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetPrices);
        await relay;

        expect(relay.isResolved).toBe(true);
        expect(relay.value!.items).toHaveLength(2);
        expect(relay.value!.items[0].token).toBe('BTC');
        expect(relay.value!.items[0].value).toBe(50000);
        expect(relay.value!.items[1].token).toBe('ETH');
      });
    });

    it('should reject when topic is not in subscription', async () => {
      class GetPrices extends TopicQuery {
        topic = 'prices:live';
        result = {
          items: t.array(t.entity(TopicPrice)),
        };
      }

      mockStream.pushSubscribed(['balances:wallet-1', 'positions:wallet-1']);

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetPrices);

        try {
          await relay;
        } catch {
          // Expected rejection
        }

        expect(relay.isRejected).toBe(true);
        expect(relay.error).toBeInstanceOf(TopicNotFoundError);
        expect((relay.error as Error).message).toContain('prices:live');
      });
    });

    it('should stay pending between subscription confirmation and data arrival', async () => {
      class GetPrices extends TopicQuery {
        topic = 'prices:live';
        result = {
          items: t.array(t.entity(TopicPrice)),
        };
      }

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetPrices);
        expect(relay.isPending).toBe(true);

        mockStream.pushSubscribed(['prices:live']);
        await sleep(20);

        expect(relay.isPending).toBe(true);

        mockStream.pushTopicData('prices:live', {
          items: [{ __typename: 'TopicPrice', id: '1', token: 'BTC', value: 50000, change24h: 2.5 }],
        });

        await relay;
        expect(relay.isResolved).toBe(true);
      });
    });

    it('should resolve multiple topic queries for different topics independently', async () => {
      class GetPrices extends TopicQuery {
        topic = 'prices:live';
        result = {
          items: t.array(t.entity(TopicPrice)),
        };
      }

      class GetBalances extends TopicQuery {
        topic = 'balances:wallet-1';
        result = {
          items: t.array(t.entity(TopicBalance)),
        };
      }

      mockStream.pushSubscribed(['prices:live', 'balances:wallet-1']);
      mockStream.pushTopicData('prices:live', {
        items: [{ __typename: 'TopicPrice', id: '1', token: 'BTC', value: 50000, change24h: 2.5 }],
      });
      mockStream.pushTopicData('balances:wallet-1', {
        items: [{ __typename: 'TopicBalance', id: '1', walletId: 'wallet-1', token: 'BTC', amount: 1.5 }],
      });

      await testWithClient(client, async () => {
        const pricesRelay = fetchQuery(GetPrices);
        const balancesRelay = fetchQuery(GetBalances);

        await Promise.all([pricesRelay, balancesRelay]);

        expect(pricesRelay.value!.items).toHaveLength(1);
        expect(pricesRelay.value!.items[0].token).toBe('BTC');

        expect(balancesRelay.value!.items).toHaveLength(1);
        expect(balancesRelay.value!.items[0].amount).toBe(1.5);
      });
    });

    it('should support parameterized topics', async () => {
      class GetBalances extends TopicQuery {
        params = { walletId: t.string };
        topic = `balances:${this.params.walletId}`;
        result = {
          items: t.array(t.entity(TopicBalance)),
        };
      }

      mockStream.pushSubscribed(['balances:wallet-1']);
      mockStream.pushTopicData('balances:wallet-1', {
        items: [{ __typename: 'TopicBalance', id: '1', walletId: 'wallet-1', token: 'BTC', amount: 1.5 }],
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetBalances, { walletId: 'wallet-1' });
        await relay;

        expect(relay.value!.items).toHaveLength(1);
        expect(relay.value!.items[0].walletId).toBe('wallet-1');
      });
    });

    it('should resolve with single entity result', async () => {
      class GetWallet extends TopicQuery {
        topic = 'wallet:main';
        result = t.entity(TopicWallet);
      }

      mockStream.pushSubscribed(['wallet:main']);
      mockStream.pushTopicData('wallet:main', {
        __typename: 'TopicWallet',
        id: 'w1',
        name: 'My Wallet',
        totalValue: 100000,
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetWallet);
        await relay;

        expect(relay.value!.name).toBe('My Wallet');
        expect(relay.value!.totalValue).toBe(100000);
      });
    });

    it('should resolve with nested entities in result', async () => {
      class GetPositionDetail extends TopicQuery {
        topic = 'position:detail';
        result = {
          position: t.entity(TopicPosition),
          wallet: t.entity(TopicWallet),
        };
      }

      mockStream.pushSubscribed(['position:detail']);
      mockStream.pushTopicData('position:detail', {
        position: {
          __typename: 'TopicPosition',
          id: 'p1',
          walletId: 'w1',
          token: 'BTC',
          size: 2.0,
          entryPrice: 45000,
        },
        wallet: {
          __typename: 'TopicWallet',
          id: 'w1',
          name: 'My Wallet',
          totalValue: 90000,
        },
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetPositionDetail);
        await relay;

        expect(relay.value!.position.token).toBe('BTC');
        expect(relay.value!.position.size).toBe(2.0);
        expect(relay.value!.wallet.name).toBe('My Wallet');
      });
    });

    it('should resolve when subscription and data are pre-pushed', async () => {
      class GetPrices extends TopicQuery {
        topic = 'prices:live';
        result = {
          items: t.array(t.entity(TopicPrice)),
        };
      }

      mockStream.pushSubscribed(['prices:live']);
      mockStream.pushTopicData('prices:live', {
        items: [{ __typename: 'TopicPrice', id: '1', token: 'BTC', value: 50000, change24h: 2.5 }],
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetPrices);
        await relay;

        expect(relay.isResolved).toBe(true);
        expect(relay.value!.items[0].value).toBe(50000);
      });
    });

    it('should maintain entity identity across queries sharing entities', async () => {
      class GetPricesA extends TopicQuery {
        topic = 'prices:a';
        result = {
          items: t.array(t.entity(TopicPrice)),
        };
      }

      class GetPricesB extends TopicQuery {
        topic = 'prices:b';
        result = {
          items: t.array(t.entity(TopicPrice)),
        };
      }

      mockStream.pushSubscribed(['prices:a', 'prices:b']);
      mockStream.pushTopicData('prices:a', {
        items: [{ __typename: 'TopicPrice', id: '1', token: 'BTC', value: 50000, change24h: 2.5 }],
      });
      mockStream.pushTopicData('prices:b', {
        items: [
          { __typename: 'TopicPrice', id: '1', token: 'BTC', value: 50000, change24h: 2.5 },
          { __typename: 'TopicPrice', id: '2', token: 'ETH', value: 3000, change24h: -1.2 },
        ],
      });

      await testWithClient(client, async () => {
        const relayA = fetchQuery(GetPricesA);
        const relayB = fetchQuery(GetPricesB);

        await Promise.all([relayA, relayB]);

        const priceFromA = relayA.value!.items[0];
        const priceFromB = relayB.value!.items[0];

        expect(priceFromA.token).toBe('BTC');
        expect(priceFromB.token).toBe('BTC');

        await applyEventOutsideReactiveContext(client, {
          type: 'update',
          typename: 'TopicPrice',
          data: { id: '1', value: 51000 },
        });

        expect(priceFromA.value).toBe(51000);
        expect(priceFromB.value).toBe(51000);
      });
    });

    it('should handle result with plain object fields', async () => {
      class GetSnapshot extends TopicQuery {
        topic = 'snapshot:daily';
        result = {
          total: t.number,
          currency: t.string,
          updatedAt: t.number,
        };
      }

      mockStream.pushSubscribed(['snapshot:daily']);
      mockStream.pushTopicData('snapshot:daily', {
        total: 150000,
        currency: 'USD',
        updatedAt: 1711000000000,
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetSnapshot);
        await relay;

        expect(relay.value!.total).toBe(150000);
        expect(relay.value!.currency).toBe('USD');
        expect(relay.value!.updatedAt).toBe(1711000000000);
      });
    });

    it('should reject only the specific query whose topic is missing', async () => {
      class GetPrices extends TopicQuery {
        topic = 'prices:live';
        result = { items: t.array(t.entity(TopicPrice)) };
      }

      class GetBalances extends TopicQuery {
        topic = 'balances:wallet-1';
        result = { items: t.array(t.entity(TopicBalance)) };
      }

      mockStream.pushSubscribed(['balances:wallet-1']);
      mockStream.pushTopicData('balances:wallet-1', {
        items: [{ __typename: 'TopicBalance', id: '1', walletId: 'wallet-1', token: 'BTC', amount: 1.5 }],
      });

      await testWithClient(client, async () => {
        const pricesRelay = fetchQuery(GetPrices);
        const balancesRelay = fetchQuery(GetBalances);

        await balancesRelay;

        try {
          await pricesRelay;
        } catch {
          // Expected rejection
        }

        expect(balancesRelay.isResolved).toBe(true);
        expect(balancesRelay.value!.items[0].token).toBe('BTC');

        expect(pricesRelay.isRejected).toBe(true);
      });
    });
  });

  // ============================================================
  // Section 2: Stream Update Events
  // ============================================================

  describe('Stream Update Events', () => {
    it('should update existing entity field via stream event', async () => {
      class GetPrices extends TopicQuery {
        topic = 'prices:live';
        result = { items: t.array(t.entity(TopicPrice)) };
      }

      mockStream.pushSubscribed(['prices:live']);
      mockStream.pushTopicData('prices:live', {
        items: [
          { __typename: 'TopicPrice', id: '1', token: 'BTC', value: 50000, change24h: 2.5 },
          { __typename: 'TopicPrice', id: '2', token: 'ETH', value: 3000, change24h: -1.2 },
        ],
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetPrices);
        await relay;

        expect(relay.value!.items[0].value).toBe(50000);

        await pushUpdateOutsideReactiveContext(mockStream, 'prices:live', {
          type: 'update',
          typename: 'TopicPrice',
          data: { id: '1', value: 51000 },
        });

        expect(relay.value!.items[0].value).toBe(51000);
        expect(relay.value!.items[0].token).toBe('BTC');
      });
    });

    it('should preserve untouched fields on partial update', async () => {
      class GetPrices extends TopicQuery {
        topic = 'prices:live';
        result = { items: t.array(t.entity(TopicPrice)) };
      }

      mockStream.pushSubscribed(['prices:live']);
      mockStream.pushTopicData('prices:live', {
        items: [{ __typename: 'TopicPrice', id: '1', token: 'BTC', value: 50000, change24h: 2.5 }],
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetPrices);
        await relay;

        await pushUpdateOutsideReactiveContext(mockStream, 'prices:live', {
          type: 'update',
          typename: 'TopicPrice',
          data: { id: '1', change24h: 5.0 },
        });

        expect(relay.value!.items[0].value).toBe(50000);
        expect(relay.value!.items[0].change24h).toBe(5.0);
        expect(relay.value!.items[0].token).toBe('BTC');
      });
    });

    it('should add entity to live array via create event with constraints', async () => {
      class TopicBalanceList extends Entity {
        __typename = t.typename('TopicBalanceList');
        id = t.id;
        walletId = t.string;
        items = t.liveArray(TopicBalance, { constraints: { walletId: (this as any).id } });
      }

      class GetBalanceList extends TopicQuery {
        topic = 'balances:wallet-1';
        result = { list: t.entity(TopicBalanceList) };
      }

      mockStream.pushSubscribed(['balances:wallet-1']);
      mockStream.pushTopicData('balances:wallet-1', {
        list: {
          __typename: 'TopicBalanceList',
          id: 'wallet-1',
          walletId: 'wallet-1',
          items: [{ __typename: 'TopicBalance', id: '1', walletId: 'wallet-1', token: 'BTC', amount: 1.5 }],
        },
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetBalanceList);
        await relay;

        const items = reactive(() => relay.value!.list.items);
        expect(items()).toHaveLength(1);

        await pushUpdateOutsideReactiveContext(mockStream, 'balances:wallet-1', {
          type: 'create',
          typename: 'TopicBalance',
          data: { __typename: 'TopicBalance', id: '2', walletId: 'wallet-1', token: 'ETH', amount: 10.0 },
        });

        expect(items()).toHaveLength(2);
        expect(items()[1].token).toBe('ETH');
        expect(items()[1].amount).toBe(10.0);
      });
    });

    it('should remove entity from live array via delete event', async () => {
      class TopicBalanceList extends Entity {
        __typename = t.typename('TopicBalanceList');
        id = t.id;
        walletId = t.string;
        items = t.liveArray(TopicBalance, { constraints: { walletId: (this as any).id } });
      }

      class GetBalanceList extends TopicQuery {
        topic = 'balances:wallet-1';
        result = { list: t.entity(TopicBalanceList) };
      }

      mockStream.pushSubscribed(['balances:wallet-1']);
      mockStream.pushTopicData('balances:wallet-1', {
        list: {
          __typename: 'TopicBalanceList',
          id: 'wallet-1',
          walletId: 'wallet-1',
          items: [
            { __typename: 'TopicBalance', id: '1', walletId: 'wallet-1', token: 'BTC', amount: 1.5 },
            { __typename: 'TopicBalance', id: '2', walletId: 'wallet-1', token: 'ETH', amount: 10.0 },
          ],
        },
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetBalanceList);
        await relay;

        const items = reactive(() => relay.value!.list.items);
        expect(items()).toHaveLength(2);

        await pushUpdateOutsideReactiveContext(mockStream, 'balances:wallet-1', {
          type: 'delete',
          typename: 'TopicBalance',
          data: { __typename: 'TopicBalance', id: '1', walletId: 'wallet-1' },
        });

        expect(items()).toHaveLength(1);
        expect(items()[0].token).toBe('ETH');
      });
    });

    it('should handle delete event with string id', async () => {
      class TopicBalanceList extends Entity {
        __typename = t.typename('TopicBalanceList');
        id = t.id;
        walletId = t.string;
        items = t.liveArray(TopicBalance, { constraints: { walletId: (this as any).id } });
      }

      class GetBalanceList extends TopicQuery {
        topic = 'balances:wallet-1';
        result = { list: t.entity(TopicBalanceList) };
      }

      mockStream.pushSubscribed(['balances:wallet-1']);
      mockStream.pushTopicData('balances:wallet-1', {
        list: {
          __typename: 'TopicBalanceList',
          id: 'wallet-1',
          walletId: 'wallet-1',
          items: [{ __typename: 'TopicBalance', id: '1', walletId: 'wallet-1', token: 'BTC', amount: 1.5 }],
        },
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetBalanceList);
        await relay;

        const items = reactive(() => relay.value!.list.items);
        expect(items()).toHaveLength(1);

        await pushUpdateOutsideReactiveContext(mockStream, 'balances:wallet-1', {
          type: 'delete',
          typename: 'TopicBalance',
          data: '1',
        });

        expect(items()).toHaveLength(0);
      });
    });

    it('should update nested entity through parent', async () => {
      class GetPositionDetail extends TopicQuery {
        topic = 'position:detail';
        result = {
          position: t.entity(TopicPosition),
          wallet: t.entity(TopicWallet),
        };
      }

      mockStream.pushSubscribed(['position:detail']);
      mockStream.pushTopicData('position:detail', {
        position: {
          __typename: 'TopicPosition',
          id: 'p1',
          walletId: 'w1',
          token: 'BTC',
          size: 2.0,
          entryPrice: 45000,
        },
        wallet: {
          __typename: 'TopicWallet',
          id: 'w1',
          name: 'Main Wallet',
          totalValue: 90000,
        },
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetPositionDetail);
        await relay;

        expect(relay.value!.wallet.totalValue).toBe(90000);

        await pushUpdateOutsideReactiveContext(mockStream, 'position:detail', {
          type: 'update',
          typename: 'TopicWallet',
          data: { id: 'w1', totalValue: 95000 },
        });

        expect(relay.value!.wallet.totalValue).toBe(95000);
        expect(relay.value!.wallet.name).toBe('Main Wallet');
      });
    });

    it('should handle multiple rapid successive events', async () => {
      class GetPrices extends TopicQuery {
        topic = 'prices:live';
        result = { items: t.array(t.entity(TopicPrice)) };
      }

      mockStream.pushSubscribed(['prices:live']);
      mockStream.pushTopicData('prices:live', {
        items: [
          { __typename: 'TopicPrice', id: '1', token: 'BTC', value: 50000, change24h: 2.5 },
          { __typename: 'TopicPrice', id: '2', token: 'ETH', value: 3000, change24h: -1.2 },
        ],
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetPrices);
        await relay;

        await pushUpdateOutsideReactiveContext(mockStream, 'prices:live', {
          type: 'update',
          typename: 'TopicPrice',
          data: { id: '1', value: 51000 },
        });
        await pushUpdateOutsideReactiveContext(mockStream, 'prices:live', {
          type: 'update',
          typename: 'TopicPrice',
          data: { id: '2', value: 3100 },
        });
        await pushUpdateOutsideReactiveContext(mockStream, 'prices:live', {
          type: 'update',
          typename: 'TopicPrice',
          data: { id: '1', value: 52000 },
        });

        expect(relay.value!.items[0].value).toBe(52000);
        expect(relay.value!.items[1].value).toBe(3100);
      });
    });

    it('should be a no-op for events with unregistered typename', async () => {
      class GetPrices extends TopicQuery {
        topic = 'prices:live';
        result = { items: t.array(t.entity(TopicPrice)) };
      }

      mockStream.pushSubscribed(['prices:live']);
      mockStream.pushTopicData('prices:live', {
        items: [{ __typename: 'TopicPrice', id: '1', token: 'BTC', value: 50000, change24h: 2.5 }],
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetPrices);
        await relay;

        const sizeBefore = getEntityMapSize(client);

        await pushUpdateOutsideReactiveContext(mockStream, 'prices:live', {
          type: 'create',
          typename: 'CompletelyUnknownType',
          data: { id: '1', name: 'Unknown' },
        });

        expect(getEntityMapSize(client)).toBe(sizeBefore);
        expect(relay.value!.items[0].value).toBe(50000);
      });
    });

    it('should also update entities via direct applyMutationEvent', async () => {
      class GetPrices extends TopicQuery {
        topic = 'prices:live';
        result = { items: t.array(t.entity(TopicPrice)) };
      }

      mockStream.pushSubscribed(['prices:live']);
      mockStream.pushTopicData('prices:live', {
        items: [{ __typename: 'TopicPrice', id: '1', token: 'BTC', value: 50000, change24h: 2.5 }],
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetPrices);
        await relay;

        await applyEventOutsideReactiveContext(client, {
          type: 'update',
          typename: 'TopicPrice',
          data: { id: '1', value: 55000 },
        });

        expect(relay.value!.items[0].value).toBe(55000);
      });
    });

    it('should not affect unrelated query entities', async () => {
      class GetPrices extends TopicQuery {
        topic = 'prices:live';
        result = { items: t.array(t.entity(TopicPrice)) };
      }

      class GetBalances extends TopicQuery {
        topic = 'balances:wallet-1';
        result = { items: t.array(t.entity(TopicBalance)) };
      }

      mockStream.pushSubscribed(['prices:live', 'balances:wallet-1']);
      mockStream.pushTopicData('prices:live', {
        items: [{ __typename: 'TopicPrice', id: '1', token: 'BTC', value: 50000, change24h: 2.5 }],
      });
      mockStream.pushTopicData('balances:wallet-1', {
        items: [{ __typename: 'TopicBalance', id: '1', walletId: 'wallet-1', token: 'BTC', amount: 1.5 }],
      });

      await testWithClient(client, async () => {
        const pricesRelay = fetchQuery(GetPrices);
        const balancesRelay = fetchQuery(GetBalances);
        await Promise.all([pricesRelay, balancesRelay]);

        await pushUpdateOutsideReactiveContext(mockStream, 'prices:live', {
          type: 'update',
          typename: 'TopicPrice',
          data: { id: '1', value: 55000 },
        });

        expect(pricesRelay.value!.items[0].value).toBe(55000);
        expect(balancesRelay.value!.items[0].amount).toBe(1.5);
      });
    });
  });

  // ============================================================
  // Section 3: Mutations with TopicQuery
  // ============================================================

  describe('Mutations with TopicQuery', () => {
    it('should add to live array via mutation create effect', async () => {
      class TopicBalanceList extends Entity {
        __typename = t.typename('TopicBalanceList');
        id = t.id;
        walletId = t.string;
        items = t.liveArray(TopicBalance, { constraints: { walletId: (this as any).id } });
      }

      class GetBalanceList extends TopicQuery {
        topic = 'balances:wallet-1';
        result = { list: t.entity(TopicBalanceList) };
      }

      class AddBalance extends RESTMutation {
        params = { __typename: t.string, id: t.id, walletId: t.string, token: t.string, amount: t.number };
        path = '/balances';
        method = 'POST' as const;
        result = { ok: t.boolean };
        effects = {
          creates: [[TopicBalance, this.params] as const],
        };
      }

      mockStream.pushSubscribed(['balances:wallet-1']);
      mockStream.pushTopicData('balances:wallet-1', {
        list: {
          __typename: 'TopicBalanceList',
          id: 'wallet-1',
          walletId: 'wallet-1',
          items: [{ __typename: 'TopicBalance', id: '1', walletId: 'wallet-1', token: 'BTC', amount: 1.5 }],
        },
      });

      mockFetch.post('/balances', { ok: true });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetBalanceList);
        await relay;

        const items = reactive(() => relay.value!.list.items);
        expect(items()).toHaveLength(1);

        const mut = getMutation(AddBalance);
        await mut.run({
          __typename: 'TopicBalance',
          id: '2',
          walletId: 'wallet-1',
          token: 'ETH',
          amount: 10.0,
        });
        await sleep(10);

        expect(items()).toHaveLength(2);
        expect(items()[1].token).toBe('ETH');
      });
    });

    it('should update entity via mutation update effect', async () => {
      class GetPrices extends TopicQuery {
        topic = 'prices:live';
        result = { items: t.array(t.entity(TopicPrice)) };
      }

      class UpdatePrice extends RESTMutation {
        params = { id: t.id, value: t.number };
        path = '/prices/update';
        method = 'PUT' as const;
        result = { ok: t.boolean };
        effects = {
          updates: [[TopicPrice, this.params] as const],
        };
      }

      mockStream.pushSubscribed(['prices:live']);
      mockStream.pushTopicData('prices:live', {
        items: [{ __typename: 'TopicPrice', id: '1', token: 'BTC', value: 50000, change24h: 2.5 }],
      });

      mockFetch.put('/prices/update', { ok: true });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetPrices);
        await relay;

        expect(relay.value!.items[0].value).toBe(50000);

        const mut = getMutation(UpdatePrice);
        await mut.run({ id: '1', value: 55000 });
        await sleep(10);

        expect(relay.value!.items[0].value).toBe(55000);
        expect(relay.value!.items[0].token).toBe('BTC');
      });
    });

    it('should remove from live array via mutation delete effect', async () => {
      class TopicBalanceList extends Entity {
        __typename = t.typename('TopicBalanceList');
        id = t.id;
        walletId = t.string;
        items = t.liveArray(TopicBalance, { constraints: { walletId: (this as any).id } });
      }

      class GetBalanceList extends TopicQuery {
        topic = 'balances:wallet-1';
        result = { list: t.entity(TopicBalanceList) };
      }

      class RemoveBalance extends RESTMutation {
        params = { id: t.id };
        path = `/balances/${this.params.id}`;
        method = 'DELETE' as const;
        result = { ok: t.boolean };
        effects = {
          deletes: [[TopicBalance, this.params.id] as const],
        };
      }

      mockStream.pushSubscribed(['balances:wallet-1']);
      mockStream.pushTopicData('balances:wallet-1', {
        list: {
          __typename: 'TopicBalanceList',
          id: 'wallet-1',
          walletId: 'wallet-1',
          items: [
            { __typename: 'TopicBalance', id: '1', walletId: 'wallet-1', token: 'BTC', amount: 1.5 },
            { __typename: 'TopicBalance', id: '2', walletId: 'wallet-1', token: 'ETH', amount: 10.0 },
          ],
        },
      });

      mockFetch.delete('/balances/[id]', { ok: true });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetBalanceList);
        await relay;

        const items = reactive(() => relay.value!.list.items);
        expect(items()).toHaveLength(2);

        const mut = getMutation(RemoveBalance);
        await mut.run({ id: '1' });
        await sleep(10);

        expect(items()).toHaveLength(1);
        expect(items()[0].token).toBe('ETH');
      });
    });

    it('should support getEffects() dynamic effects', async () => {
      class TopicBalanceList extends Entity {
        __typename = t.typename('TopicBalanceList');
        id = t.id;
        walletId = t.string;
        items = t.liveArray(TopicBalance, { constraints: { walletId: (this as any).id } });
      }

      class GetBalanceList extends TopicQuery {
        topic = 'balances:wallet-1';
        result = { list: t.entity(TopicBalanceList) };
      }

      class TransferBalance extends RESTMutation {
        params = { fromId: t.string, toId: t.string, newFromAmount: t.number, newToAmount: t.number };
        path = '/balances/transfer';
        method = 'POST' as const;
        result = { ok: t.boolean };

        getEffects() {
          return {
            updates: [
              [TopicBalance, { id: this.params.fromId, amount: this.params.newFromAmount }] as const,
              [TopicBalance, { id: this.params.toId, amount: this.params.newToAmount }] as const,
            ],
          };
        }
      }

      mockStream.pushSubscribed(['balances:wallet-1']);
      mockStream.pushTopicData('balances:wallet-1', {
        list: {
          __typename: 'TopicBalanceList',
          id: 'wallet-1',
          walletId: 'wallet-1',
          items: [
            { __typename: 'TopicBalance', id: '1', walletId: 'wallet-1', token: 'BTC', amount: 1.5 },
            { __typename: 'TopicBalance', id: '2', walletId: 'wallet-1', token: 'ETH', amount: 10.0 },
          ],
        },
      });

      mockFetch.post('/balances/transfer', { ok: true });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetBalanceList);
        await relay;

        const items = reactive(() => relay.value!.list.items);
        expect(items()[0].amount).toBe(1.5);
        expect(items()[1].amount).toBe(10.0);

        const mut = getMutation(TransferBalance);
        await mut.run({ fromId: '1', toId: '2', newFromAmount: 0.5, newToAmount: 11.0 });
        await sleep(10);

        expect(items()[0].amount).toBe(0.5);
        expect(items()[1].amount).toBe(11.0);
      });
    });

    it('should handle multiple mutations in sequence', async () => {
      class TopicBalanceList extends Entity {
        __typename = t.typename('TopicBalanceList');
        id = t.id;
        walletId = t.string;
        items = t.liveArray(TopicBalance, { constraints: { walletId: (this as any).id } });
      }

      class GetBalanceList extends TopicQuery {
        topic = 'balances:wallet-1';
        result = { list: t.entity(TopicBalanceList) };
      }

      class AddBalance extends RESTMutation {
        params = { __typename: t.string, id: t.id, walletId: t.string, token: t.string, amount: t.number };
        path = '/balances';
        method = 'POST' as const;
        result = { ok: t.boolean };
        effects = {
          creates: [[TopicBalance, this.params] as const],
        };
      }

      mockStream.pushSubscribed(['balances:wallet-1']);
      mockStream.pushTopicData('balances:wallet-1', {
        list: {
          __typename: 'TopicBalanceList',
          id: 'wallet-1',
          walletId: 'wallet-1',
          items: [],
        },
      });

      mockFetch.post('/balances', { ok: true });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetBalanceList);
        await relay;

        const items = reactive(() => relay.value!.list.items);
        expect(items()).toHaveLength(0);

        const mut = getMutation(AddBalance);
        await mut.run({ __typename: 'TopicBalance', id: '1', walletId: 'wallet-1', token: 'BTC', amount: 1.0 });
        await sleep(10);
        expect(items()).toHaveLength(1);

        await mut.run({ __typename: 'TopicBalance', id: '2', walletId: 'wallet-1', token: 'ETH', amount: 5.0 });
        await sleep(10);
        expect(items()).toHaveLength(2);

        await mut.run({ __typename: 'TopicBalance', id: '3', walletId: 'wallet-1', token: 'SOL', amount: 100.0 });
        await sleep(10);
        expect(items()).toHaveLength(3);

        expect(items()[0].token).toBe('BTC');
        expect(items()[1].token).toBe('ETH');
        expect(items()[2].token).toBe('SOL');
      });
    });

    it('should create entity matching live array constraint', async () => {
      class TopicBalanceList extends Entity {
        __typename = t.typename('TopicBalanceList');
        id = t.id;
        walletId = t.string;
        items = t.liveArray(TopicBalance, { constraints: { walletId: (this as any).id } });
      }

      class GetBalanceList extends TopicQuery {
        topic = 'balances:wallet-1';
        result = { list: t.entity(TopicBalanceList) };
      }

      mockStream.pushSubscribed(['balances:wallet-1']);
      mockStream.pushTopicData('balances:wallet-1', {
        list: {
          __typename: 'TopicBalanceList',
          id: 'wallet-1',
          walletId: 'wallet-1',
          items: [],
        },
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetBalanceList);
        await relay;

        const items = reactive(() => relay.value!.list.items);
        expect(items()).toHaveLength(0);

        await applyEventOutsideReactiveContext(client, {
          type: 'create',
          typename: 'TopicBalance',
          data: { __typename: 'TopicBalance', id: '1', walletId: 'wallet-1', token: 'BTC', amount: 1.5 },
        });

        expect(items()).toHaveLength(1);
        expect(items()[0].token).toBe('BTC');
      });
    });

    it('should not add entity to live array when constraint does not match', async () => {
      class TopicBalanceList extends Entity {
        __typename = t.typename('TopicBalanceList');
        id = t.id;
        walletId = t.string;
        items = t.liveArray(TopicBalance, { constraints: { walletId: (this as any).id } });
      }

      class GetBalanceList extends TopicQuery {
        topic = 'balances:wallet-1';
        result = { list: t.entity(TopicBalanceList) };
      }

      mockStream.pushSubscribed(['balances:wallet-1']);
      mockStream.pushTopicData('balances:wallet-1', {
        list: {
          __typename: 'TopicBalanceList',
          id: 'wallet-1',
          walletId: 'wallet-1',
          items: [],
        },
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetBalanceList);
        await relay;

        const items = reactive(() => relay.value!.list.items);
        expect(items()).toHaveLength(0);

        await applyEventOutsideReactiveContext(client, {
          type: 'create',
          typename: 'TopicBalance',
          data: { __typename: 'TopicBalance', id: '1', walletId: 'wallet-999', token: 'BTC', amount: 1.5 },
        });

        expect(items()).toHaveLength(0);
      });
    });
  });

  // ============================================================
  // Section 4: loadNext with TopicQuery
  // ============================================================

  describe('loadNext with TopicQuery', () => {
    class TopicItem extends Entity {
      __typename = t.typename('TopicItem');
      id = t.id;
      name = t.string;
    }

    it('should fetch next page using loadNextUrl and cursor', async () => {
      class GetItems extends TopicQuery {
        topic = 'items:list';
        result = {
          items: t.liveArray(TopicItem),
          cursor: t.optional(t.string),
        };
        loadNext = {
          searchParams: {
            cursor: this.result.cursor,
          },
        };
      }

      mockStream.pushSubscribed(['items:list']);
      mockStream.pushTopicData(
        'items:list',
        {
          items: [
            { __typename: 'TopicItem', id: '1', name: 'first' },
            { __typename: 'TopicItem', id: '2', name: 'second' },
          ],
          cursor: 'c1',
        },
        { loadNextUrl: '/api/items/next' },
      );

      mockFetch.get('/api/items/next', {
        items: [{ __typename: 'TopicItem', id: '3', name: 'third' }],
        cursor: 'c2',
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetItems);
        await relay;

        expect(relay.value!.items).toHaveLength(2);
        expect(relay.value!.cursor).toBe('c1');

        await relay.value!.__loadNext();

        const lastCall = mockFetch.calls[mockFetch.calls.length - 1];
        expect(lastCall.url).toContain('/api/items/next');
        expect(lastCall.url).toContain('cursor=c1');

        expect(relay.value!.items).toHaveLength(3);
        expect(relay.value!.items[2].name).toBe('third');
        expect(relay.value!.cursor).toBe('c2');
      });
    });

    it('should accumulate live array items across loadNext calls', async () => {
      class GetItems extends TopicQuery {
        topic = 'items:list';
        result = {
          items: t.liveArray(TopicItem),
          cursor: t.optional(t.string),
        };
        loadNext = {
          searchParams: { cursor: this.result.cursor },
        };
      }

      mockStream.pushSubscribed(['items:list']);
      mockStream.pushTopicData(
        'items:list',
        {
          items: [{ __typename: 'TopicItem', id: '1', name: 'first' }],
          cursor: 'c1',
        },
        { loadNextUrl: '/api/items/next' },
      );

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetItems);
        await relay;
        expect(relay.value!.items).toHaveLength(1);

        mockFetch.get('/api/items/next', {
          items: [{ __typename: 'TopicItem', id: '2', name: 'second' }],
          cursor: 'c2',
        });
        await relay.value!.__loadNext();
        expect(relay.value!.items).toHaveLength(2);

        mockFetch.get('/api/items/next', {
          items: [
            { __typename: 'TopicItem', id: '3', name: 'third' },
            { __typename: 'TopicItem', id: '4', name: 'fourth' },
          ],
          cursor: undefined,
        });
        await relay.value!.__loadNext();
        expect(relay.value!.items).toHaveLength(4);
        expect(relay.value!.items[0].name).toBe('first');
        expect(relay.value!.items[3].name).toBe('fourth');
      });
    });

    it('should advance cursor with each loadNext response', async () => {
      class GetItems extends TopicQuery {
        topic = 'items:list';
        result = {
          items: t.liveArray(TopicItem),
          cursor: t.optional(t.string),
        };
        loadNext = {
          searchParams: { cursor: this.result.cursor },
        };
      }

      mockStream.pushSubscribed(['items:list']);
      mockStream.pushTopicData(
        'items:list',
        {
          items: [{ __typename: 'TopicItem', id: '1', name: 'first' }],
          cursor: 'c1',
        },
        { loadNextUrl: '/api/items/next' },
      );

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetItems);
        await relay;

        mockFetch.get('/api/items/next', {
          items: [{ __typename: 'TopicItem', id: '2', name: 'second' }],
          cursor: 'c2',
        });
        await relay.value!.__loadNext();
        expect(mockFetch.calls[0].url).toContain('cursor=c1');

        mockFetch.get('/api/items/next', {
          items: [{ __typename: 'TopicItem', id: '3', name: 'third' }],
          cursor: 'c3',
        });
        await relay.value!.__loadNext();
        expect(mockFetch.calls[1].url).toContain('cursor=c2');
      });
    });

    it('should deduplicate entities in live array on loadNext', async () => {
      class GetItems extends TopicQuery {
        topic = 'items:list';
        result = {
          items: t.liveArray(TopicItem),
          cursor: t.optional(t.string),
        };
        loadNext = {
          searchParams: { cursor: this.result.cursor },
        };
      }

      mockStream.pushSubscribed(['items:list']);
      mockStream.pushTopicData(
        'items:list',
        {
          items: [
            { __typename: 'TopicItem', id: '1', name: 'first' },
            { __typename: 'TopicItem', id: '2', name: 'second' },
          ],
          cursor: 'c1',
        },
        { loadNextUrl: '/api/items/next' },
      );

      mockFetch.get('/api/items/next', {
        items: [
          { __typename: 'TopicItem', id: '2', name: 'second-updated' },
          { __typename: 'TopicItem', id: '3', name: 'third' },
        ],
        cursor: 'c2',
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetItems);
        await relay;

        await relay.value!.__loadNext();

        expect(relay.value!.items).toHaveLength(3);
        expect(relay.value!.items[1].name).toBe('second-updated');
        expect(relay.value!.items[2].name).toBe('third');
      });
    });

    it('should reflect __hasNext based on cursor value', async () => {
      class GetItems extends TopicQuery {
        topic = 'items:list';
        result = {
          items: t.liveArray(TopicItem),
          cursor: t.optional(t.string),
        };
        loadNext = {
          searchParams: { cursor: this.result.cursor },
        };
      }

      mockStream.pushSubscribed(['items:list']);
      mockStream.pushTopicData(
        'items:list',
        {
          items: [{ __typename: 'TopicItem', id: '1', name: 'first' }],
          cursor: 'c1',
        },
        { loadNextUrl: '/api/items/next' },
      );

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetItems);
        await relay;

        expect(relay.value!.__hasNext).toBe(true);

        mockFetch.get('/api/items/next', {
          items: [{ __typename: 'TopicItem', id: '2', name: 'second' }],
        });
        await relay.value!.__loadNext();

        expect(relay.value!.__hasNext).toBe(false);
      });
    });

    it('should show correct __isLoadingNext states', async () => {
      class GetItems extends TopicQuery {
        topic = 'items:list';
        result = {
          items: t.liveArray(TopicItem),
          cursor: t.optional(t.string),
        };
        loadNext = {
          searchParams: { cursor: this.result.cursor },
        };
      }

      mockStream.pushSubscribed(['items:list']);
      mockStream.pushTopicData(
        'items:list',
        {
          items: [{ __typename: 'TopicItem', id: '1', name: 'first' }],
          cursor: 'c1',
        },
        { loadNextUrl: '/api/items/next' },
      );

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetItems);
        await relay;

        expect(relay.value!.__isLoadingNext).toBe(false);

        mockFetch.get('/api/items/next', {
          items: [{ __typename: 'TopicItem', id: '2', name: 'second' }],
          cursor: undefined,
        });
        await relay.value!.__loadNext();

        expect(relay.value!.__isLoadingNext).toBe(false);
      });
    });

    it('should preserve prior state on loadNext error', async () => {
      class GetItems extends TopicQuery {
        topic = 'items:list';
        result = {
          items: t.liveArray(TopicItem),
          cursor: t.optional(t.string),
        };
        loadNext = {
          searchParams: { cursor: this.result.cursor },
        };
      }

      mockStream.pushSubscribed(['items:list']);
      mockStream.pushTopicData(
        'items:list',
        {
          items: [
            { __typename: 'TopicItem', id: '1', name: 'first' },
            { __typename: 'TopicItem', id: '2', name: 'second' },
          ],
          cursor: 'c1',
        },
        { loadNextUrl: '/api/items/next' },
      );

      mockFetch.get('/api/items/next', null, { error: new Error('Network error') });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetItems);
        await relay;

        expect(relay.value!.items).toHaveLength(2);

        await expect(relay.value!.__loadNext()).rejects.toThrow('Network error');

        expect(relay.value!.items).toHaveLength(2);
        expect(relay.value!.cursor).toBe('c1');
      });
    });

    it('should return false for __hasNext when no loadNext is configured', async () => {
      class GetItems extends TopicQuery {
        topic = 'items:list';
        result = {
          items: t.array(t.entity(TopicItem)),
        };
      }

      mockStream.pushSubscribed(['items:list']);
      mockStream.pushTopicData('items:list', {
        items: [{ __typename: 'TopicItem', id: '1', name: 'first' }],
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetItems);
        await relay;

        expect(relay.value!.__hasNext).toBe(false);
      });
    });
  });

  // ============================================================
  // Section 5: Combined / Integration Scenarios
  // ============================================================

  describe('Combined Scenarios', () => {
    class TopicItem extends Entity {
      __typename = t.typename('TopicCombinedItem');
      id = t.id;
      listId = t.string;
      name = t.string;
    }

    class TopicCombinedList extends Entity {
      __typename = t.typename('TopicCombinedList');
      id = t.id;
      items = t.liveArray(TopicItem, { constraints: { listId: (this as any).id } });
    }

    it('should reflect both loadNext and stream update in final state', async () => {
      class GetList extends TopicQuery {
        topic = 'list:main';
        result = {
          list: t.entity(TopicCombinedList),
          cursor: t.optional(t.string),
        };
        loadNext = {
          searchParams: { cursor: this.result.cursor },
        };
      }

      mockStream.pushSubscribed(['list:main']);
      mockStream.pushTopicData(
        'list:main',
        {
          list: {
            __typename: 'TopicCombinedList',
            id: 'main',
            items: [{ __typename: 'TopicCombinedItem', id: '1', listId: 'main', name: 'A' }],
          },
          cursor: 'c1',
        },
        { loadNextUrl: '/api/list/next' },
      );

      mockFetch.get('/api/list/next', {
        list: {
          __typename: 'TopicCombinedList',
          id: 'main',
          items: [{ __typename: 'TopicCombinedItem', id: '2', listId: 'main', name: 'B' }],
        },
        cursor: undefined,
      });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetList);
        await relay;

        expect(relay.value!.list.items).toHaveLength(1);

        await relay.value!.__loadNext();
        expect(relay.value!.list.items).toHaveLength(2);

        await applyEventOutsideReactiveContext(client, {
          type: 'update',
          typename: 'TopicCombinedItem',
          data: { id: '1', name: 'A-updated' },
        });

        expect(relay.value!.list.items).toHaveLength(2);
        expect(relay.value!.list.items[0].name).toBe('A-updated');
        expect(relay.value!.list.items[1].name).toBe('B');
      });
    });

    it('should handle stream update then loadNext correctly', async () => {
      class GetList extends TopicQuery {
        topic = 'list:main';
        result = {
          list: t.entity(TopicCombinedList),
          cursor: t.optional(t.string),
        };
        loadNext = {
          searchParams: { cursor: this.result.cursor },
        };
      }

      mockStream.pushSubscribed(['list:main']);
      mockStream.pushTopicData(
        'list:main',
        {
          list: {
            __typename: 'TopicCombinedList',
            id: 'main',
            items: [{ __typename: 'TopicCombinedItem', id: '1', listId: 'main', name: 'A' }],
          },
          cursor: 'c1',
        },
        { loadNextUrl: '/api/list/next' },
      );

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetList);
        await relay;

        const items = reactive(() => relay.value!.list.items);

        await pushUpdateOutsideReactiveContext(mockStream, 'list:main', {
          type: 'create',
          typename: 'TopicCombinedItem',
          data: { __typename: 'TopicCombinedItem', id: '10', listId: 'main', name: 'Stream-Created' },
        });

        expect(items()).toHaveLength(2);

        mockFetch.get('/api/list/next', {
          list: {
            __typename: 'TopicCombinedList',
            id: 'main',
            items: [{ __typename: 'TopicCombinedItem', id: '2', listId: 'main', name: 'B' }],
          },
          cursor: undefined,
        });

        await relay.value!.__loadNext();

        expect(items()).toHaveLength(3);
      });
    });

    it('should handle mutation effect then stream update without duplicates', async () => {
      class GetList extends TopicQuery {
        topic = 'list:main';
        result = { list: t.entity(TopicCombinedList) };
      }

      class AddItem extends RESTMutation {
        params = { __typename: t.string, id: t.id, listId: t.string, name: t.string };
        path = '/items';
        method = 'POST' as const;
        result = { ok: t.boolean };
        effects = {
          creates: [[TopicItem, this.params] as const],
        };
      }

      mockStream.pushSubscribed(['list:main']);
      mockStream.pushTopicData('list:main', {
        list: {
          __typename: 'TopicCombinedList',
          id: 'main',
          items: [{ __typename: 'TopicCombinedItem', id: '1', listId: 'main', name: 'A' }],
        },
      });

      mockFetch.post('/items', { ok: true });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetList);
        await relay;

        const items = reactive(() => relay.value!.list.items);

        const mut = getMutation(AddItem);
        await mut.run({ __typename: 'TopicCombinedItem', id: '2', listId: 'main', name: 'B' });
        await sleep(10);
        expect(items()).toHaveLength(2);

        await pushUpdateOutsideReactiveContext(mockStream, 'list:main', {
          type: 'update',
          typename: 'TopicCombinedItem',
          data: { id: '2', name: 'B-updated' },
        });

        expect(items()).toHaveLength(2);
        expect(items()[1].name).toBe('B-updated');
      });
    });

    it('should handle loadNext + mutation + stream update in sequence', async () => {
      class GetList extends TopicQuery {
        topic = 'list:main';
        result = {
          list: t.entity(TopicCombinedList),
          cursor: t.optional(t.string),
        };
        loadNext = {
          searchParams: { cursor: this.result.cursor },
        };
      }

      class AddItem extends RESTMutation {
        params = { __typename: t.string, id: t.id, listId: t.string, name: t.string };
        path = '/items';
        method = 'POST' as const;
        result = { ok: t.boolean };
        effects = {
          creates: [[TopicItem, this.params] as const],
        };
      }

      mockStream.pushSubscribed(['list:main']);
      mockStream.pushTopicData(
        'list:main',
        {
          list: {
            __typename: 'TopicCombinedList',
            id: 'main',
            items: [{ __typename: 'TopicCombinedItem', id: '1', listId: 'main', name: 'A' }],
          },
          cursor: 'c1',
        },
        { loadNextUrl: '/api/list/next' },
      );

      mockFetch.get('/api/list/next', {
        list: {
          __typename: 'TopicCombinedList',
          id: 'main',
          items: [{ __typename: 'TopicCombinedItem', id: '2', listId: 'main', name: 'B' }],
        },
        cursor: undefined,
      });
      mockFetch.post('/items', { ok: true });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetList);
        await relay;

        const items = reactive(() => relay.value!.list.items);
        expect(items()).toHaveLength(1);

        await relay.value!.__loadNext();
        expect(items()).toHaveLength(2);

        const mut = getMutation(AddItem);
        await mut.run({ __typename: 'TopicCombinedItem', id: '3', listId: 'main', name: 'C' });
        await sleep(10);
        expect(items()).toHaveLength(3);

        await applyEventOutsideReactiveContext(client, {
          type: 'update',
          typename: 'TopicCombinedItem',
          data: { id: '1', name: 'A-final' },
        });

        expect(items()).toHaveLength(3);
        expect(items()[0].name).toBe('A-final');
        expect(items()[1].name).toBe('B');
        expect(items()[2].name).toBe('C');
      });
    });

    it('should deduplicate when stream creates entity then loadNext returns it', async () => {
      class GetList extends TopicQuery {
        topic = 'list:main';
        result = {
          list: t.entity(TopicCombinedList),
          cursor: t.optional(t.string),
        };
        loadNext = {
          searchParams: { cursor: this.result.cursor },
        };
      }

      mockStream.pushSubscribed(['list:main']);
      mockStream.pushTopicData(
        'list:main',
        {
          list: {
            __typename: 'TopicCombinedList',
            id: 'main',
            items: [{ __typename: 'TopicCombinedItem', id: '1', listId: 'main', name: 'A' }],
          },
          cursor: 'c1',
        },
        { loadNextUrl: '/api/list/next' },
      );

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetList);
        await relay;

        const items = reactive(() => relay.value!.list.items);

        await pushUpdateOutsideReactiveContext(mockStream, 'list:main', {
          type: 'create',
          typename: 'TopicCombinedItem',
          data: { __typename: 'TopicCombinedItem', id: '2', listId: 'main', name: 'B' },
        });

        expect(items()).toHaveLength(2);

        mockFetch.get('/api/list/next', {
          list: {
            __typename: 'TopicCombinedList',
            id: 'main',
            items: [{ __typename: 'TopicCombinedItem', id: '2', listId: 'main', name: 'B-server' }],
          },
          cursor: undefined,
        });

        await relay.value!.__loadNext();

        expect(items()).toHaveLength(2);
        expect(items()[1].name).toBe('B-server');
      });
    });

    it('full lifecycle: subscribe → data → loadNext → stream updates → mutation', async () => {
      class GetList extends TopicQuery {
        topic = 'list:full';
        result = {
          list: t.entity(TopicCombinedList),
          cursor: t.optional(t.string),
        };
        loadNext = {
          searchParams: { cursor: this.result.cursor },
        };
      }

      class RemoveItem extends RESTMutation {
        params = { id: t.id };
        path = `/items/${this.params.id}`;
        method = 'DELETE' as const;
        result = { ok: t.boolean };
        effects = {
          deletes: [[TopicItem, this.params.id] as const],
        };
      }

      mockFetch.delete('/items/[id]', { ok: true });

      await testWithClient(client, async () => {
        const relay = fetchQuery(GetList);
        expect(relay.isPending).toBe(true);

        mockStream.pushSubscribed(['list:full', 'prices:live']);
        await sleep(10);
        expect(relay.isPending).toBe(true);

        mockStream.pushTopicData(
          'list:full',
          {
            list: {
              __typename: 'TopicCombinedList',
              id: 'full',
              items: [
                { __typename: 'TopicCombinedItem', id: '1', listId: 'full', name: 'Alpha' },
                { __typename: 'TopicCombinedItem', id: '2', listId: 'full', name: 'Beta' },
              ],
            },
            cursor: 'page-2',
          },
          { loadNextUrl: '/api/list/next' },
        );

        await relay;
        expect(relay.isResolved).toBe(true);
        const items = reactive(() => relay.value!.list.items);
        expect(items()).toHaveLength(2);

        mockFetch.get('/api/list/next', {
          list: {
            __typename: 'TopicCombinedList',
            id: 'full',
            items: [{ __typename: 'TopicCombinedItem', id: '3', listId: 'full', name: 'Gamma' }],
          },
          cursor: undefined,
        });

        await relay.value!.__loadNext();
        expect(items()).toHaveLength(3);
        expect(items()[2].name).toBe('Gamma');

        await applyEventOutsideReactiveContext(client, {
          type: 'update',
          typename: 'TopicCombinedItem',
          data: { id: '1', name: 'Alpha-Updated' },
        });

        expect(items()[0].name).toBe('Alpha-Updated');

        await applyEventOutsideReactiveContext(client, {
          type: 'create',
          typename: 'TopicCombinedItem',
          data: { __typename: 'TopicCombinedItem', id: '4', listId: 'full', name: 'Delta' },
        });

        expect(items()).toHaveLength(4);

        const mut = getMutation(RemoveItem);
        await mut.run({ id: '2' });
        await sleep(10);

        expect(items()).toHaveLength(3);
        expect(items().map((i: any) => i.name)).toEqual(['Alpha-Updated', 'Gamma', 'Delta']);
      });
    });
  });
});
