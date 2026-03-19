import { getContext, ReactiveTask } from 'signalium';
import {
  ExtractType,
  ExtractTypesFromObjectOrEntity,
  InternalTypeDef,
  MutationResultValue,
  ParseAndApply,
  TypeDef,
  RetryConfig,
  ResponseTypeDef,
  QueryRequestOptions,
} from './types.js';
import { QueryClientContext, QueryContext, resolveBaseUrl } from './QueryClient.js';
import { Prettify } from './type-utils.js';
import { resolveTypeDef } from './resolveTypeDef.js';
import { createDefinitionProxy, extractDefinition, type CapturedDefinition } from './fieldRef.js';

// ================================
// Mutation Definition Types
// ================================

export interface MutationConfigOptions {
  retry?: RetryConfig | number | false;
}

export interface MutationDefinition<Request, Response> {
  id: string;
  requestShape: InternalTypeDef;
  requestShapeKey: number;
  responseShape: InternalTypeDef | undefined;
  responseShapeKey: number | undefined;
  captured: CapturedDefinition<Mutation>;
  optimisticUpdates: boolean;
  parseAndApply: ParseAndApply;
  config?: MutationConfigOptions;
}

// ================================
// Mutation base class
// ================================

export abstract class Mutation {
  params?: ResponseTypeDef;
  result?: ResponseTypeDef;
  optimisticUpdates?: boolean;
  parseAndApply?: ParseAndApply;
  config?: MutationConfigOptions;

  declare context: QueryContext;
  declare response: Response | undefined;

  abstract send(): Promise<unknown>;
  abstract getStorageKey(): unknown;

  constructor() {
    return createDefinitionProxy(this);
  }
}

// ================================
// JsonMutation
// ================================

export abstract class JsonMutation extends Mutation {
  path?: string;
  method: 'POST' | 'PUT' | 'DELETE' | 'PATCH' = 'POST';
  body?: Record<string, unknown>;
  headers?: HeadersInit;
  requestOptions?: QueryRequestOptions;

  getStorageKey(): string {
    return `${this.method ?? 'POST'}:${this.path ?? ''}`;
  }

  getPath(): string | undefined {
    return this.path;
  }

  getMethod(): string {
    return this.method;
  }

  getBody(): Record<string, unknown> | undefined {
    return this.body;
  }

  getRequestOptions(): QueryRequestOptions | undefined {
    return this.requestOptions;
  }

  async send(): Promise<unknown> {
    const path = this.getPath();
    const method = this.getMethod();
    const body = this.getBody();
    const requestOptions = this.getRequestOptions();

    if (!path) {
      throw new Error('JsonMutation requires a path. Define `path` as a field or override `getPath()`.');
    }

    const bodyData = body ?? (this.params as Record<string, unknown>);

    const baseUrl = resolveBaseUrl(requestOptions?.baseUrl) ?? resolveBaseUrl(this.context.baseUrl);
    const fullUrl = baseUrl ? `${baseUrl}${path}` : path;

    const { baseUrl: _baseUrl, ...fetchOptions } = requestOptions ?? {};

    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...(this.headers as Record<string, string>),
    };

    const fetchResponse = await this.context.fetch(fullUrl, {
      method,
      headers,
      body: JSON.stringify(bodyData),
      ...fetchOptions,
    });

    this.response = fetchResponse;
    return fetchResponse.json();
  }
}

// ================================
// Type extraction from Mutation classes
// ================================

export type ExtractMutationParams<T extends Mutation> =
  T['params'] extends TypeDef<infer U>
    ? U
    : T['params'] extends Record<string, TypeDef>
      ? Prettify<{ [K in keyof T['params']]: ExtractType<T['params'][K]> }>
      : // eslint-disable-next-line @typescript-eslint/no-empty-object-type
        {};

type ExtractMutationResult<T extends Mutation> =
  T['result'] extends TypeDef<infer U>
    ? U
    : T['result'] extends Record<string, TypeDef>
      ? Prettify<{ [K in keyof T['result']]: ExtractType<T['result'][K]> }>
      : // eslint-disable-next-line @typescript-eslint/no-empty-object-type
        {};

// ================================
// Mutation definition cache and lookup
// ================================

const mutationDefCache = new WeakMap<new () => Mutation, () => MutationDefinition<any, any>>();

export const mutationKeyForClass = (cls: new () => Mutation): string => {
  const getMutationDef = mutationDefCache.get(cls);

  if (getMutationDef === undefined) {
    throw new Error('Mutation definition not found');
  }

  return getMutationDef().id;
};

// ================================
// Internal: build mutation definition from class
// ================================

function buildMutationDefinition(MutationClass: new () => Mutation): () => MutationDefinition<any, any> {
  let cached = mutationDefCache.get(MutationClass);

  if (cached !== undefined) {
    return cached;
  }

  let mutationDefinition: MutationDefinition<any, any> | undefined;

  const getter = (): MutationDefinition<any, any> => {
    if (mutationDefinition !== undefined) {
      return mutationDefinition;
    }

    const instance = new MutationClass();
    const captured = extractDefinition(instance);
    const { fields } = captured;

    const id = `mutation:${String(captured.methods.getStorageKey.call(fields))}`;

    const { shape: requestShape, shapeKey: requestShapeKey } = resolveTypeDef(fields.params ?? {});
    const resolved = fields.result ? resolveTypeDef(fields.result) : undefined;

    mutationDefinition = {
      id,
      requestShape,
      requestShapeKey,
      responseShape: resolved?.shape,
      responseShapeKey: resolved?.shapeKey,
      captured,
      optimisticUpdates: fields.optimisticUpdates ?? false,
      parseAndApply: fields.parseAndApply ?? 'both',
      config: fields.config,
    };

    return mutationDefinition;
  };

  mutationDefCache.set(MutationClass, getter);
  return getter;
}

// ================================
// Public API
// ================================

export function getMutation<T extends Mutation>(
  MutationClass: new () => T,
): ReactiveTask<MutationResultValue<Readonly<ExtractMutationResult<T>>>, [ExtractMutationParams<T>]> {
  const getMutationDef = buildMutationDefinition(MutationClass);

  const queryClient = getContext(QueryClientContext);

  if (queryClient === undefined) {
    throw new Error('QueryClient not found');
  }

  return queryClient.getMutation<any, any>(getMutationDef());
}
