import { getContext, ReactiveTask } from 'signalium';
import {
  ExtractType,
  InternalTypeDef,
  MutationEffects,
  TypeDef,
  RetryConfig,
  TypeDefShape,
  QueryRequestOptions,
} from './types.js';
import { QueryClientContext, QueryContext, resolveBaseUrl } from './QueryClient.js';
import { ValidatorDef, t } from './typeDefs.js';
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
  responseShape: InternalTypeDef | undefined;
  captured: CapturedDefinition<Mutation>;
  optimisticUpdates: boolean;
  config?: MutationConfigOptions;
  effects?: MutationEffects;
  hasGetEffects: boolean;
}

// ================================
// Mutation base class
// ================================

export abstract class Mutation {
  readonly params?: TypeDefShape;
  readonly result?: TypeDefShape;
  readonly optimisticUpdates?: boolean;
  readonly config?: MutationConfigOptions;
  readonly effects?: Readonly<MutationEffects>;

  declare context: QueryContext;
  declare response: Response | undefined;
  declare signal: AbortSignal;

  abstract send(): Promise<unknown>;
  abstract getStorageKey(): unknown;

  getEffects?(): MutationEffects;

  constructor() {
    return createDefinitionProxy(this);
  }
}

// ================================
// RESTMutation
// ================================

export abstract class RESTMutation extends Mutation {
  path?: string;
  method: 'POST' | 'PUT' | 'DELETE' | 'PATCH' = 'POST';
  body?: Record<string, unknown>;
  headers?: HeadersInit;
  requestOptions?: QueryRequestOptions;

  getStorageKey(): string {
    return `${this.method ?? 'POST'}:${this.path ?? ''}`;
  }

  getPath?(): string | undefined;
  getMethod?(): string;
  getBody?(): Record<string, unknown> | undefined;
  getRequestOptions?(): QueryRequestOptions | undefined;

  async send(): Promise<unknown> {
    const path = this.getPath ? this.getPath() : this.path;
    const method = this.getMethod ? this.getMethod() : this.method;
    const body = this.getBody ? this.getBody() : this.body;
    const requestOptions = this.getRequestOptions ? this.getRequestOptions() : this.requestOptions;

    if (!path) {
      throw new Error('RESTMutation requires a path. Define `path` as a field or override `getPath()`.');
    }

    const bodyData = body ?? (this.params as Record<string, unknown>);

    const baseUrl = resolveBaseUrl(requestOptions?.baseUrl) ?? resolveBaseUrl(this.context.baseUrl);
    const fullUrl = baseUrl ? `${baseUrl}${path}` : path;

    const { baseUrl: _baseUrl, signal: _signal, ...fetchOptions } = requestOptions ?? ({} as Record<string, unknown>);

    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...(this.headers as Record<string, string>),
    };

    const fetchResponse = await this.context.fetch(fullUrl, {
      method,
      headers,
      body: JSON.stringify(bodyData),
      signal: this.signal,
      ...fetchOptions,
    });

    this.response = fetchResponse;
    return fetchResponse.json();
  }
}

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

    const requestDef = fields.params ?? {};
    const requestShape = (requestDef instanceof ValidatorDef
      ? requestDef
      : t.object(requestDef)) as unknown as InternalTypeDef;
    const responseDef = fields.result;
    const responseShape =
      responseDef !== undefined
        ? ((responseDef instanceof ValidatorDef ? responseDef : t.object(responseDef)) as unknown as InternalTypeDef)
        : undefined;

    mutationDefinition = {
      id,
      requestShape,
      responseShape,
      captured,
      optimisticUpdates: fields.optimisticUpdates ?? false,
      config: fields.config,
      effects: fields.effects,
      hasGetEffects: typeof captured.methods.getEffects === 'function',
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
): ReactiveTask<Readonly<ExtractType<T['result']>>, [ExtractType<T['params']>]> {
  const getMutationDef = buildMutationDefinition(MutationClass);

  const queryClient = getContext(QueryClientContext);

  if (queryClient === undefined) {
    throw new Error('QueryClient not found');
  }

  return queryClient.getMutation<any, any>(getMutationDef());
}
