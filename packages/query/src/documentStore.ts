export type MaybePromise<T> = T | Promise<T>;

export interface PersistentStore {
  getString(key: string): MaybePromise<string | undefined>;
  setString(key: string, value: string): MaybePromise<void>;

  getNumber(key: string): MaybePromise<number | undefined>;
  setNumber(key: string, value: number): MaybePromise<void>;

  getBuffer(key: string): MaybePromise<Uint32Array | undefined>;
  setBuffer(key: string, value: Uint32Array): MaybePromise<void>;

  delete(key: string): MaybePromise<void>;
}

export class MemoryPersistentStore implements PersistentStore {
  private readonly kv: Record<string, unknown> = {};

  getString(key: string): string | undefined {
    return this.kv[key] as string | undefined;
  }

  setString(key: string, value: string): void {
    this.kv[key] = value;
  }

  getNumber(key: string): number | undefined {
    return this.kv[key] as number | undefined;
  }

  setNumber(key: string, value: number): void {
    this.kv[key] = value;
  }

  getBuffer(key: string): Uint32Array | undefined {
    return this.kv[key] as Uint32Array | undefined;
  }

  setBuffer(key: string, value: Uint32Array): void {
    this.kv[key] = value;
  }

  delete(key: string): void {
    delete this.kv[key];
  }
}

const valueKeyFor = (id: number) => `sq:doc:value:${id}`;
const refCountKeyFor = (id: number) => `sq:doc:refCount:${id}`;
const refIdsKeyFor = (id: number) => `sq:doc:refIds:${id}`;

export class NormalizedDocumentStore {
  constructor(private readonly kv: PersistentStore) {}

  async get<T>(id: number): Promise<T | undefined> {
    const value = await this.kv.getString(valueKeyFor(id));

    if (value === undefined) {
      return undefined;
    }

    return JSON.parse(value);
  }

  async set(id: number, value: unknown, refIds?: Uint32Array): Promise<void> {
    const kv = this.kv;

    await kv.setString(valueKeyFor(id), JSON.stringify(value));

    const refIdsKey = refIdsKeyFor(id);

    const prevRefIds = await kv.getBuffer(refIdsKey);

    if (refIds === undefined) {
      kv.delete(refIdsKey);

      // Decrement all previous refs
      if (prevRefIds !== undefined) {
        for (let i = 0; i < prevRefIds.length; i++) {
          const refId = prevRefIds[i];
          if (refId !== 0 && prevRefIds.indexOf(refId) === i) {
            // Only process first occurrence of each refId
            await this.decrementRefCount(refId);
          }
        }
      }
    } else {
      if (prevRefIds !== undefined) {
        // Process new refs: increment if not in old
        for (const refId of refIds) {
          const index = prevRefIds.indexOf(refId);

          if (index === -1) {
            await this.incrementRefCount(refId);
          } else {
            // This refId was already in the previous set - delete it from the set
            prevRefIds[index] = 0;
          }
        }

        // Process removed refs: decrement if not in new (non-zero entries in prevRefIds)
        for (let i = 0; i < prevRefIds.length; i++) {
          const refId = prevRefIds[i];
          if (refId !== 0 && prevRefIds.indexOf(refId) === i) {
            // Only process first occurrence
            await this.decrementRefCount(refId);
          }
        }
      } else {
        // No previous refs, increment all unique new refs
        for (let i = 0; i < refIds.length; i++) {
          const refId = refIds[i];
          // Only process first occurrence
          if (refIds.indexOf(refId) === i) {
            await this.incrementRefCount(refId);
          }
        }
      }

      await kv.setBuffer(refIdsKey, refIds);
    }
  }

  async delete(id: number): Promise<void> {
    const kv = this.kv;

    await kv.delete(valueKeyFor(id));
    await kv.delete(refCountKeyFor(id));

    const refIds = await kv.getBuffer(refIdsKeyFor(id));
    await kv.delete(refIdsKeyFor(id)); // Clean up the refIds key

    if (refIds === undefined) {
      return;
    }

    // Decrement ref counts for all referenced entities
    for (const refId of refIds) {
      if (refId !== 0) {
        await this.decrementRefCount(refId);
      }
    }
  }

  private async incrementRefCount(refId: number): Promise<void> {
    const refCountKey = refCountKeyFor(refId);
    const currentCount = (await this.kv.getNumber(refCountKey)) ?? 0;
    const newCount = currentCount + 1;
    await this.kv.setNumber(refCountKey, newCount);
  }

  private async decrementRefCount(refId: number): Promise<void> {
    const refCountKey = refCountKeyFor(refId);
    const currentCount = await this.kv.getNumber(refCountKey);

    if (currentCount === undefined) {
      // Already deleted or never existed
      return;
    }

    const newCount = currentCount - 1;

    if (newCount === 0) {
      // Entity exists, cascade delete it
      await this.delete(refId);
    } else {
      await this.kv.setNumber(refCountKey, newCount);
    }
  }
}
