import { task, type ReactiveTask } from 'signalium';
import { ComplexTypeDef, MutationResultValue } from './types.js';
import { ValidatorDef } from './typeDefs.js';
import { type QueryClient } from './QueryClient.js';
import { MutationDefinition } from './mutation.js';
import { resolveRetryConfig } from './query.js';
import { createExecutionContext } from './fieldRef.js';

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

  constructor(def: MutationDefinition<Request, Response>, queryClient: QueryClient) {
    this.def = def;
    this.queryClient = queryClient;
    this.task = this.createTask();
  }

  private createTask(): ReactiveTask<MutationResultValue<Response>, [Request]> {
    return task(async (request: Request): Promise<MutationResultValue<Response>> => {
      const { parseAndApply } = this.def;
      const applyRequest = parseAndApply === 'both' || parseAndApply === 'request';
      const applyResponse = parseAndApply === 'both' || parseAndApply === 'response';

      const response = await this.executeWithRetry(request);

      if (applyRequest) {
        this.applyRequestEntities(request);
      }

      let parsedResponse: Response;
      if (applyResponse) {
        parsedResponse = this.parseAndUpdateEntities(response);
      } else {
        parsedResponse = response as Response;
      }

      return parsedResponse as MutationResultValue<Response>;
    });
  }

  private applyRequestEntities(request: Request): void {
    const requestShape = this.def.requestShape;

    if (!(requestShape instanceof ValidatorDef)) {
      return;
    }

    this.queryClient.parseEntities(request, requestShape as ComplexTypeDef, new Set());
  }

  private parseAndUpdateEntities(response: unknown): Response {
    const responseShape = this.def.responseShape;

    if (!(responseShape instanceof ValidatorDef)) {
      return response as Response;
    }

    const entityRefs = new Set<number>();
    const parsed = this.queryClient.parseEntities(response, responseShape as ComplexTypeDef, entityRefs);

    return parsed as Response;
  }

  // ======================================================
  // Retry logic
  // ======================================================

  private async executeWithRetry(request: Request): Promise<Response> {
    const { retries, retryDelay } = resolveRetryConfig(this.def.config?.retry, true);
    let lastError: unknown;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const ctx = createExecutionContext(
          this.def.captured,
          (request ?? {}) as Record<string, unknown>,
          this.queryClient.getContext(),
        );

        return (await this.def.captured.methods.send.call(ctx)) as Response;
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
