import { task, type ReactiveTask } from 'signalium';
import { hashValue } from 'signalium/utils';
import {
  ArrayDef,
  BaseMutationResult,
  ComplexTypeDef,
  EntityDef,
  Mask,
  MutationResult,
  ObjectDef,
  ObjectFieldTypeDef,
  RecordDef,
  UnionDef,
} from './types.js';
import { parseEntities } from './parseEntities.js';
import { ValidatorDef } from './typeDefs.js';
import { type QueryClient } from './QueryClient.js';
import { MutationDefinition } from './mutation.js';
import { typeMaskOf } from './utils.js';

// ======================================================
// MutationResultImpl
// ======================================================

/**
 * MutationResult is a thin wrapper around ReactiveTask that adds:
 * - Optimistic update support with rollback on failure
 * - Entity parsing from responses
 * - reset() functionality
 */
export class MutationResultImpl<Request, Response> implements BaseMutationResult<Request, Response> {
  def: MutationDefinition<Request, Response>;
  private queryClient: QueryClient;

  // The underlying ReactiveTask that handles all state management
  private _task: ReactiveTask<Response, [Request]>;

  // Track which entity keys we've registered optimistic updates for
  // EntityMap handles the actual snapshots
  private _pendingOptimisticKeys: Set<number> = new Set();

  constructor(def: MutationDefinition<Request, Response>, queryClient: QueryClient) {
    this.def = def;
    this.queryClient = queryClient;
    this._task = this.createTask();
  }

  private createTask(): ReactiveTask<Response, [Request]> {
    return task(async (request: Request): Promise<Response> => {
      try {
        const response = await this.executeWithRetry(request);

        // Parse response and update entities
        const parsedResponse = this.parseAndUpdateEntities(response);

        // Clear optimistic update tracking on success (updates are now confirmed)
        this.clearOptimisticUpdates();

        return parsedResponse;
      } catch (error) {
        // Revert optimistic updates on failure
        this.revertOptimisticUpdates();
        throw error;
      }
    });
  }

  // ======================================================
  // Delegated ReactivePromise properties
  // ======================================================

  get value(): Response | undefined {
    return this._task.value;
  }

  get error(): unknown {
    return this._task.error;
  }

  get isPending(): boolean {
    return this._task.isPending;
  }

  get isRejected(): boolean {
    return this._task.isRejected;
  }

  get isResolved(): boolean {
    return this._task.isResolved;
  }

  get isSettled(): boolean {
    return this._task.isSettled;
  }

  get isReady(): boolean {
    return this._task.isReady;
  }

  // ======================================================
  // Promise interface (delegated)
  // ======================================================

  then<TResult1 = Response, TResult2 = never>(
    onfulfilled?: ((value: Response) => TResult1 | PromiseLike<TResult1>) | null | undefined,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null | undefined,
  ): Promise<TResult1 | TResult2> {
    return this._task.then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null | undefined,
  ): Promise<Response | TResult> {
    return this._task.catch(onrejected);
  }

  finally(onfinally?: (() => void) | null | undefined): Promise<Response> {
    return this._task.finally(onfinally);
  }

  get [Symbol.toStringTag](): string {
    return 'MutationResult';
  }

  // ======================================================
  // Mutation execution
  // ======================================================

  run = (request: Request): MutationResult<Request, Response> => {
    // Apply optimistic updates if enabled
    if (this.def.optimisticUpdates) {
      this.applyOptimisticUpdates(request);
    }

    // Run the underlying task
    this._task.run(request);

    return this as unknown as MutationResult<Request, Response>;
  };

  reset = (): void => {
    // Revert any pending optimistic updates
    this.revertOptimisticUpdates();

    // Create a fresh task to reset state
    this._task = this.createTask();
  };

  // ======================================================
  // Optimistic updates
  // ======================================================

  private applyOptimisticUpdates(request: Request): void {
    // Clear any previous tracking
    this._pendingOptimisticKeys.clear();

    const requestShape = this.def.requestShape;

    if (!(requestShape instanceof ValidatorDef)) {
      return;
    }

    // Recursively find and update all entities in the request
    this.findAndUpdateEntities(request, requestShape as ComplexTypeDef);
  }

  /**
   * Recursively walks the data according to its shape, finding and updating all entities.
   */
  private findAndUpdateEntities(value: unknown, def: ComplexTypeDef): void {
    const valueType = typeMaskOf(value);
    const defType = def.mask;

    // Skip primitives and incompatible types
    if (valueType < Mask.OBJECT || (defType & valueType) === 0) {
      return;
    }

    // Handle unions - find the matching type
    if ((defType & Mask.UNION) !== 0) {
      const unionDef = def as UnionDef;
      if (valueType === Mask.ARRAY) {
        const arrayShape = unionDef.shape!['[]' as keyof typeof unionDef.shape];
        if (arrayShape && typeof arrayShape !== 'number') {
          this.findAndUpdateEntitiesInArray(value as unknown[], arrayShape as ComplexTypeDef);
        }
      } else {
        const typenameField = unionDef.typenameField;
        const typename = typenameField ? (value as Record<string, unknown>)[typenameField] : undefined;
        if (typename && typeof typename === 'string') {
          const matchingDef = unionDef.shape![typename as keyof typeof unionDef.shape];
          if (matchingDef && typeof matchingDef !== 'number') {
            this.findAndUpdateEntitiesInObject(value as Record<string, unknown>, matchingDef as ObjectDef | EntityDef);
          }
        }
      }
      return;
    }

    // Handle arrays
    if (valueType === Mask.ARRAY) {
      const arrayShape = (def as ArrayDef).shape;
      if (arrayShape && typeof arrayShape !== 'number') {
        this.findAndUpdateEntitiesInArray(value as unknown[], arrayShape as ComplexTypeDef);
      }
      return;
    }

    // Handle records
    if ((defType & Mask.RECORD) !== 0) {
      const recordShape = (def as RecordDef).shape;
      if (recordShape && typeof recordShape !== 'number') {
        for (const item of Object.values(value as Record<string, unknown>)) {
          this.findAndUpdateEntities(item, recordShape as ComplexTypeDef);
        }
      }
      return;
    }

    // Handle objects/entities
    this.findAndUpdateEntitiesInObject(value as Record<string, unknown>, def as ObjectDef | EntityDef);
  }

  private findAndUpdateEntitiesInArray(array: unknown[], shape: ComplexTypeDef): void {
    for (const item of array) {
      this.findAndUpdateEntities(item, shape);
    }
  }

  private findAndUpdateEntitiesInObject(obj: Record<string, unknown>, def: ObjectDef | EntityDef): void {
    const { mask } = def;

    // If this is an entity, update it in the store
    if (mask & Mask.ENTITY) {
      const entityDef = def as EntityDef;
      const idField = entityDef.idField;
      const entityId = obj[idField];

      if (entityId !== undefined) {
        const typename = entityDef.typenameValue;
        const entityKey = hashValue([`${typename}:${entityId}`, entityDef.shapeKey]);

        // Register the optimistic update
        this.queryClient.registerOptimisticUpdate(entityKey, obj);
        this._pendingOptimisticKeys.add(entityKey);
      }
    }

    // Recurse into sub-entity paths to find nested entities
    const shape = def.shape;
    const subEntityPaths = def.subEntityPaths;

    if (subEntityPaths !== undefined) {
      if (typeof subEntityPaths === 'string') {
        const propDef = shape[subEntityPaths];
        if (propDef && typeof propDef !== 'number') {
          this.findAndUpdateEntities(obj[subEntityPaths], propDef as ComplexTypeDef);
        }
      } else {
        for (const path of subEntityPaths) {
          const propDef = shape[path] as ObjectFieldTypeDef;
          if (propDef && typeof propDef !== 'number') {
            this.findAndUpdateEntities(obj[path], propDef as ComplexTypeDef);
          }
        }
      }
    }
  }

  private revertOptimisticUpdates(): void {
    // Revert each optimistic update - EntityMap handles restoring snapshots
    for (const entityKey of this._pendingOptimisticKeys) {
      this.queryClient.revertOptimisticUpdate(entityKey);
    }
    this._pendingOptimisticKeys.clear();
  }

  private clearOptimisticUpdates(): void {
    // Clear optimistic update tracking (mutation succeeded, updates are confirmed)
    for (const entityKey of this._pendingOptimisticKeys) {
      this.queryClient.clearOptimisticUpdates(entityKey);
    }
    this._pendingOptimisticKeys.clear();
  }

  // ======================================================
  // Response parsing
  // ======================================================

  private parseAndUpdateEntities(response: unknown): Response {
    const responseShape = this.def.responseShape;

    if (!(responseShape instanceof ValidatorDef)) {
      return response as Response;
    }

    // Parse entities from response and update the entity store
    const entityRefs = new Set<number>();
    const parsed = parseEntities(response, responseShape as ComplexTypeDef, this.queryClient, entityRefs);

    return parsed as Response;
  }

  // ======================================================
  // Retry logic
  // ======================================================

  private async executeWithRetry(request: Request): Promise<Response> {
    const { retries, retryDelay } = this.getRetryConfig();
    let lastError: unknown;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await this.def.mutateFn(this.queryClient.getContext(), request);
      } catch (error) {
        lastError = error;

        // If we've exhausted retries, throw the error
        if (attempt >= retries) {
          throw error;
        }

        // Wait before retrying
        const delay = retryDelay(attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    // Should never reach here, but TypeScript needs it
    throw lastError;
  }

  private getRetryConfig(): { retries: number; retryDelay: (attempt: number) => number } {
    const retryOption = this.def.cache?.retry;

    let retries: number;
    let retryDelay: (attempt: number) => number;

    if (retryOption === false) {
      retries = 0;
    } else if (retryOption === undefined) {
      retries = 0; // Mutations default to no retries
    } else if (typeof retryOption === 'number') {
      retries = retryOption;
    } else {
      retries = retryOption.retries;
    }

    // Default exponential backoff: 1000ms * 2^attempt
    if (typeof retryOption === 'object' && retryOption.retryDelay) {
      retryDelay = retryOption.retryDelay;
    } else {
      retryDelay = (attempt: number) => 1000 * Math.pow(2, attempt);
    }

    return { retries, retryDelay };
  }
}
