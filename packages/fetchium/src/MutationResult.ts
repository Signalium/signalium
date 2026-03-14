import { task, type ReactiveTask } from 'signalium';
import { hashValue } from 'signalium/utils';
import {
  ArrayDef,
  ComplexTypeDef,
  EntityDef,
  InternalObjectFieldTypeDef,
  Mask,
  MutationResultValue,
  ObjectDef,
  RecordDef,
  UnionDef,
} from './types.js';
import { parseEntities } from './parseEntities.js';
import { ValidatorDef } from './typeDefs.js';
import { type QueryClient } from './QueryClient.js';
import { MutationDefinition } from './mutation.js';
import { resolveRetryConfig } from './query.js';
import { typeMaskOf } from './utils.js';

// ======================================================
// MutationResultImpl
// ======================================================

/**
 * Internal mutation manager. Consumers interact with the public `task` property,
 * which is a standard ReactiveTask whose resolved value is the parsed response.
 */
export class MutationResultImpl<Request, Response> {
  def: MutationDefinition<Request, Response>;
  private queryClient: QueryClient;

  /** The public-facing ReactiveTask returned to consumers. */
  readonly task: ReactiveTask<MutationResultValue<Response>, [Request]>;

  // Track which entity keys we've registered optimistic updates for
  // EntityMap handles the actual snapshots
  private _pendingOptimisticKeys: Set<number> = new Set();

  constructor(def: MutationDefinition<Request, Response>, queryClient: QueryClient) {
    this.def = def;
    this.queryClient = queryClient;
    this.task = this.createTask();
  }

  private createTask(): ReactiveTask<MutationResultValue<Response>, [Request]> {
    return task(
      async (request: Request): Promise<MutationResultValue<Response>> => {
        const { optimisticUpdates, parseAndApply } = this.def;
        const applyRequest = parseAndApply === 'both' || parseAndApply === 'request';
        const applyResponse = parseAndApply === 'both' || parseAndApply === 'response';

        try {
          // Apply optimistic updates from request immediately (before await)
          if (optimisticUpdates && applyRequest) {
            this.applyOptimisticUpdates(request);
          }

          const response = await this.executeWithRetry(request);

          // Apply request entities to store on success (non-optimistic path)
          if (applyRequest && !optimisticUpdates) {
            this.applyRequestEntities(request);
          }

          // Parse and apply response entities
          let parsedResponse: Response;
          if (applyResponse) {
            parsedResponse = this.parseAndUpdateEntities(response);
          } else {
            parsedResponse = response as Response;
          }

          // Confirm any optimistic changes (no-op if no pending keys)
          this.clearOptimisticUpdates();

          return parsedResponse as MutationResultValue<Response>;
        } catch (error) {
          // Revert optimistic updates on failure
          this.revertOptimisticUpdates();
          throw error;
        }
      },
      this.def.optimisticUpdates ? { throwIfRunning: true } : undefined,
    );
  }

  // ======================================================
  // Optimistic updates
  // ======================================================

  /**
   * Apply request entities as optimistic updates (immediate, before await).
   * Walks the request data to find entities and registers them as pending updates.
   */
  private applyOptimisticUpdates(request: Request): void {
    this._pendingOptimisticKeys.clear();

    const requestShape = this.def.requestShape;

    if (!(requestShape instanceof ValidatorDef)) {
      return;
    }

    this.findAndUpdateEntities(request, requestShape as ComplexTypeDef);
  }

  /**
   * Apply request entities to the store (non-optimistic, on success).
   * Uses parseEntities which calls saveEntity for each entity found.
   */
  private applyRequestEntities(request: Request): void {
    const requestShape = this.def.requestShape;

    if (!(requestShape instanceof ValidatorDef)) {
      return;
    }

    parseEntities(request, requestShape as ComplexTypeDef, this.queryClient, new Set());
  }

  /**
   * Recursively walks data according to its shape, finding and registering
   * optimistic updates for all entities.
   */
  private findAndUpdateEntities(value: unknown, def: ComplexTypeDef): void {
    const valueType = typeMaskOf(value);
    const defType = def.mask;

    // Skip primitives and incompatible types
    if (valueType < Mask.OBJECT || (defType & valueType) === 0) {
      return;
    }

    // Handle unions
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

    // If this is an entity, register it as an optimistic update
    if (mask & Mask.ENTITY) {
      const entityDef = def as EntityDef;
      const idField = entityDef.idField;
      const entityId = obj[idField];

      if (entityId !== undefined) {
        const typename = entityDef.typenameValue;
        const entityKey = hashValue([`${typename}:${entityId}`, entityDef.shapeKey]);

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
          const propDef = shape[path] as InternalObjectFieldTypeDef;
          if (propDef && typeof propDef !== 'number') {
            this.findAndUpdateEntities(obj[path], propDef as ComplexTypeDef);
          }
        }
      }
    }
  }

  private revertOptimisticUpdates(): void {
    for (const entityKey of this._pendingOptimisticKeys) {
      this.queryClient.revertOptimisticUpdate(entityKey);
    }
    this._pendingOptimisticKeys.clear();
  }

  private clearOptimisticUpdates(): void {
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

    const entityRefs = new Set<number>();
    const parsed = parseEntities(response, responseShape as ComplexTypeDef, this.queryClient, entityRefs);

    return parsed as Response;
  }

  // ======================================================
  // Retry logic
  // ======================================================

  private async executeWithRetry(request: Request): Promise<Response> {
    // Mutations default to 0 retries (isServer=true forces 0 in resolveRetryConfig)
    const { retries, retryDelay } = resolveRetryConfig(this.def.cache?.retry, true);
    let lastError: unknown;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await this.def.mutateFn(this.queryClient.getContext(), request);
      } catch (error) {
        lastError = error;

        if (attempt >= retries) {
          throw error;
        }

        const delay = retryDelay(attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }
}
