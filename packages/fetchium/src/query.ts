import { getContext } from 'signalium';
import {
  InternalTypeDef,
  ExtractType,
  TypeDef,
  QueryRequestOptions,
  ResponseTypeDef,
  RetryConfig,
  QueryPromise,
} from './types.js';
import {
  QueryCacheOptions,
  QueryConfigOptions,
  QueryClientContext,
  QueryContext,
  QueryParams,
  queryKeyFor,
  resolveBaseUrl,
} from './QueryClient.js';
import { HasRequiredKeys, Optionalize, Signalize } from './type-utils.js';
import { resolveTypeDef } from './resolveTypeDef.js';
import {
  createDefinitionProxy,
  extractDefinition,
  createExecutionContext as createExecutionContextUtil,
  type CapturedDefinition,
} from './fieldRef.js';

// ================================
// Stream options
// ================================

export type StreamSubscribeFn<Params extends QueryParams | undefined, StreamType> = (
  context: QueryContext,
  params: Params,
  onUpdate: (update: StreamType) => void,
) => () => void;

export interface StreamOptions<Event extends Record<string, TypeDef> | TypeDef = Record<string, TypeDef> | TypeDef> {
  type: Event;
  subscribe: StreamSubscribeFn<any, any>;
}

export interface ResolvedStreamOptions {
  shape: InternalTypeDef;
  shapeKey: number;
  subscribeFn: StreamSubscribeFn<any, any>;
}

// ================================
// Retry config
// ================================

export interface ResolvedRetryConfig {
  retries: number;
  retryDelay: (attempt: number) => number;
}

export function resolveRetryConfig(
  retryOption: RetryConfig | number | boolean | undefined,
  isServer: boolean = typeof window === 'undefined',
): ResolvedRetryConfig {
  let retries: number;

  if (retryOption === false) {
    retries = 0;
  } else if (retryOption === undefined || retryOption === true) {
    retries = isServer ? 0 : 3;
  } else if (typeof retryOption === 'number') {
    retries = retryOption;
  } else {
    retries = retryOption.retries;
  }

  const retryDelay =
    typeof retryOption === 'object' && retryOption.retryDelay
      ? retryOption.retryDelay
      : (attempt: number) => 1000 * Math.pow(2, attempt);

  return { retries, retryDelay };
}

// ================================
// Query base class
// ================================

export abstract class Query {
  static cache?: QueryCacheOptions;

  params?: Record<string, TypeDef>;
  abstract result: ResponseTypeDef;
  config?: QueryConfigOptions;
  stream?: StreamOptions;

  declare context: QueryContext;
  declare response: Response | undefined;

  abstract getStorageKey(): unknown;
  abstract send(): Promise<unknown>;

  getConfig(): QueryConfigOptions | undefined {
    return this.config;
  }

  getStream(): StreamOptions | undefined {
    return this.stream;
  }

  constructor() {
    return createDefinitionProxy(this);
  }
}

// ================================
// JsonQuery
// ================================

export abstract class JsonQuery extends Query {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' = 'GET';
  path?: string;
  searchParams?: Record<string, unknown>;
  body?: Record<string, unknown>;
  headers?: HeadersInit;
  requestOptions?: QueryRequestOptions;

  getStorageKey(): string {
    return `${this.method ?? 'GET'}:${this.path ?? ''}`;
  }

  getPath(): string | undefined {
    return this.path;
  }

  getMethod(): string {
    return this.method;
  }

  getSearchParams(): Record<string, unknown> | undefined {
    return this.searchParams;
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
    const searchParams = this.getSearchParams();
    const body = this.getBody();
    const requestOptions = this.getRequestOptions();

    if (!path) {
      throw new Error('JsonQuery requires a path. Define `path` as a field or override `getPath()`.');
    }

    let url = path;

    if (searchParams) {
      const sp = new URLSearchParams();
      for (const key in searchParams) {
        const val = searchParams[key];
        if (val !== undefined && val !== null) {
          sp.append(key, String(val));
        }
      }
      const qs = sp.toString();
      if (qs) {
        url += '?' + qs;
      }
    }

    const baseUrl = resolveBaseUrl(requestOptions?.baseUrl) ?? resolveBaseUrl(this.context.baseUrl);
    const fullUrl = baseUrl ? `${baseUrl}${url}` : url;

    const { baseUrl: _baseUrl, ...fetchOptions } = requestOptions ?? {};

    const hasHeaders = body || this.headers;
    const headers: HeadersInit | undefined = hasHeaders
      ? {
          ...(body ? { 'Content-Type': 'application/json' } : undefined),
          ...(this.headers as Record<string, string>),
        }
      : undefined;

    const fetchResponse = await this.context.fetch(fullUrl, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      ...fetchOptions,
    });

    this.response = fetchResponse;
    return fetchResponse.json();
  }
}

// ================================
// Query definition
// ================================

const queryDefCache = new WeakMap<new () => Query, QueryDefinition<any, any, any>>();

export interface ResolvedQueryOptions {
  config: QueryConfigOptions | undefined;
  stream: ResolvedStreamOptions | undefined;
  retryConfig: ResolvedRetryConfig;
}

export interface QueryDefinitionStatics {
  readonly id: string;
  readonly shape: InternalTypeDef;
  readonly shapeKey: number;
  readonly cache: QueryCacheOptions | undefined;
}

export class QueryDefinition<Params extends QueryParams | undefined, Result, StreamType> {
  private _streamShape: { shape: InternalTypeDef; shapeKey: number } | undefined;

  readonly statics: QueryDefinitionStatics;

  constructor(
    statics: QueryDefinitionStatics,
    public readonly captured: CapturedDefinition<Query>,
  ) {
    this.statics = statics;
  }

  createExecutionContext(actualParams: Record<string, unknown>, queryContext: QueryContext): Query {
    return createExecutionContextUtil(this.captured, actualParams, queryContext);
  }

  resolveOptions(ctx: Query): ResolvedQueryOptions {
    const { methods, fields } = this.captured;

    const config = methods.getConfig?.call(ctx);
    const rawStream = methods.getStream?.call(ctx);

    let stream: ResolvedStreamOptions | undefined;
    if (rawStream) {
      if (!this._streamShape) {
        const originalStream = methods.getStream?.call(fields) ?? fields.stream;
        if (originalStream?.type) {
          this._streamShape = resolveTypeDef(originalStream.type);
        }
      }
      if (this._streamShape) {
        const { shape, shapeKey } = this._streamShape;
        stream = {
          shape,
          shapeKey,
          subscribeFn: rawStream.subscribe,
        };
      }
    }

    const retryConfig = resolveRetryConfig(config?.retry);

    return { config, stream, retryConfig };
  }

  static for(QueryClass: new () => Query): QueryDefinition<any, any, any> {
    let queryDefinition = queryDefCache.get(QueryClass);

    if (queryDefinition !== undefined) {
      return queryDefinition;
    }

    const instance = new QueryClass();
    const captured = extractDefinition(instance);

    const id = String(captured.methods.getStorageKey.call(captured.fields));
    const { shape, shapeKey } = resolveTypeDef(captured.fields.result);
    const cache = (QueryClass as typeof Query).cache;

    queryDefinition = new QueryDefinition({ id, shape, shapeKey, cache }, captured);

    queryDefCache.set(QueryClass, queryDefinition);
    return queryDefinition;
  }
}

// ================================
// Type extraction from Query classes
// ================================

export type ExtractQueryParams<T extends Query> =
  T['params'] extends Record<string, TypeDef>
    ? { [K in keyof T['params']]: ExtractType<T['params'][K]> }
    : // eslint-disable-next-line @typescript-eslint/no-empty-object-type
      {};

// ================================
// Query definition lookup
// ================================

export const queryKeyForClass = (cls: new () => Query, params: unknown): number => {
  const queryDef = QueryDefinition.for(cls);
  return queryKeyFor(queryDef, params);
};

export function getQueryDefinition(QueryClass: new () => Query): QueryDefinition<any, any, any> {
  return QueryDefinition.for(QueryClass);
}

// ================================
// Public API
// ================================

export function fetchQuery<T extends Query>(
  QueryClass: new () => T,
  ...args: HasRequiredKeys<ExtractQueryParams<T>> extends true
    ? [params: Optionalize<Signalize<ExtractQueryParams<T>>>]
    : [params?: Optionalize<Signalize<ExtractQueryParams<T>>> | undefined]
): QueryPromise<T> {
  const queryDef = QueryDefinition.for(QueryClass);

  const queryClient = getContext(QueryClientContext);

  if (queryClient === undefined) {
    throw new Error('QueryClient not found');
  }

  const params = args[0] as QueryParams | undefined;

  return queryClient.getQuery(queryDef, params);
}
