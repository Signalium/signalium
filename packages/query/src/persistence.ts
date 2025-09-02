export interface PersistentKV {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set<T = unknown>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  mget?<T = unknown>(keys: string[]): Promise<(T | undefined)[]>;
  mset?<T = unknown>(entries: Array<{ key: string; value: T }>): Promise<void>;
  mdelete?(keys: string[]): Promise<void>;
  transaction?<T>(fn: () => Promise<T>): Promise<T>;
}

export class InMemoryKV implements PersistentKV {
  private readonly map: Map<string, unknown> = new Map();

  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.map.get(key) as T | undefined;
  }

  async set<T = unknown>(key: string, value: T): Promise<void> {
    this.map.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }

  async mget<T = unknown>(keys: string[]): Promise<(T | undefined)[]> {
    return keys.map(k => this.map.get(k) as T | undefined);
  }

  async mset<T = unknown>(entries: Array<{ key: string; value: T }>): Promise<void> {
    for (const { key, value } of entries) {
      this.map.set(key, value);
    }
  }

  async mdelete(keys: string[]): Promise<void> {
    for (const key of keys) {
      this.map.delete(key);
    }
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    // In-memory impl has no isolation; run function directly
    return fn();
  }
}

export type JSONValue = null | boolean | number | string | JSONValue[] | { [k: string]: JSONValue };

export interface EntityRef {
  type: string;
  id: string;
}

export function toEntityKey(ref: EntityRef): string {
  return `entity:${ref.type}:${ref.id}`;
}

export function toQueryKey(ref: EntityRef): string {
  return `query:${ref.type}:${ref.id}`;
}
