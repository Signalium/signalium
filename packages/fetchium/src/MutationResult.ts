import { task, type ReactiveTask } from 'signalium';
import { ComplexTypeDef, MutationEffects, EntityClassOrTypename } from './types.js';
import { ValidatorDef, getEntityDef } from './typeDefs.js';
import { type QueryClient } from './QueryClient.js';
import { MutationDefinition } from './mutation.js';
import { resolveRetryConfig } from './query.js';
import { parseEntities, ParseContext } from './parseEntities.js';
import { createExecutionContext, reifyValue } from './fieldRef.js';
import { Entity } from './proxy.js';
import { withRetry } from './retry.js';

/**
 * Internal mutation manager. Consumers interact with the public `task` property,
 * which is a standard ReactiveTask whose resolved value is the validated response.
 *
 * Mutations use Phase 1 only (parseData) for response validation. Entity store
 * updates are handled exclusively through effects (creates/updates/deletes).
 */
export class MutationResultImpl<Request, Result> {
  def: MutationDefinition<Request, Result>;
  private queryClient: QueryClient;
  private _lastResponse: globalThis.Response | undefined;
  private _inFlight: boolean = false;

  readonly task: ReactiveTask<Result, [Request]>;

  constructor(def: MutationDefinition<Request, Result>, queryClient: QueryClient) {
    this.def = def;
    this.queryClient = queryClient;
    this.task = this.createTask();
  }

  private createTask(): ReactiveTask<Result, [Request]> {
    return task(
      async (request: Request): Promise<Result> => {
        if (this._inFlight) {
          throw new Error('A mutation is already in progress. Await the previous call before starting a new one.');
        }
        this._inFlight = true;
        try {
          const response = await this.executeWithRetry(request);

          const parsedResponse = this.validateResponse(response);

          this.processEffects(request, parsedResponse);

          return parsedResponse;
        } finally {
          this._inFlight = false;
        }
      },
      { desc: `Mutation(${this.def.id})` },
    );
  }

  private validateResponse(response: unknown): Result {
    const responseShape = this.def.responseShape;

    if (!(responseShape instanceof ValidatorDef)) {
      return response as Result;
    }

    const warn = this.queryClient.getContext().log?.warn ?? (() => {});
    const ctx = new ParseContext();
    ctx.reset(undefined, undefined, warn);
    return parseEntities(response, responseShape as ComplexTypeDef, ctx) as Result;
  }

  // ======================================================
  // Effects processing
  // ======================================================

  private processEffects(request: Request, parsedResult: Result): void {
    let effects: MutationEffects | undefined;

    if (this.def.hasGetEffects) {
      const ctx = createExecutionContext(
        this.def.captured,
        (request ?? {}) as Record<string, unknown>,
        this.queryClient.getContext(),
      );
      (ctx as any).result = parsedResult;
      (ctx as any).response = this._lastResponse;
      effects = (ctx as any).getEffects();
    } else if (this.def.effects !== undefined) {
      const root = { params: request as Record<string, unknown>, result: parsedResult as Record<string, unknown> };
      effects = reifyValue(this.def.effects, root as Record<string, unknown>) as MutationEffects;
    }

    if (effects === undefined) return;

    const qc = this.queryClient;
    applyEffects(effects.creates, 'create', qc);
    applyEffects(effects.updates, 'update', qc);
    applyEffects(effects.deletes, 'delete', qc);
  }

  // ======================================================
  // Retry logic
  // ======================================================

  private executeWithRetry(request: Request): Promise<Result> {
    const retryConfig = resolveRetryConfig(this.def.config?.retry, true);

    return withRetry(async () => {
      const ctx = createExecutionContext(
        this.def.captured,
        (request ?? {}) as Record<string, unknown>,
        this.queryClient.getContext(),
      );

      const result = (await this.def.captured.methods.send.call(ctx)) as Result;
      this._lastResponse = (ctx as any).response;
      return result;
    }, retryConfig);
  }
}

function resolveTypename(entityRef: EntityClassOrTypename): string | undefined {
  if (typeof entityRef === 'string') return entityRef;
  const def = getEntityDef(entityRef as new () => Entity);
  return def.typenameValue;
}

function applyEffects(
  entries: ReadonlyArray<readonly [EntityClassOrTypename, unknown]> | undefined,
  type: 'create' | 'update' | 'delete',
  qc: QueryClient,
): void {
  if (!entries) return;
  for (const [entityRef, data] of entries) {
    const typename = resolveTypename(entityRef);
    if (typename !== undefined) {
      qc.applyMutationEvent({ type, typename, data: data as Record<string, unknown> });
    }
  }
}
