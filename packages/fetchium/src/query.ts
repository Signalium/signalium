import { getContext } from 'signalium';
import {
  ExtractType,
  TypeDef,
  QueryRequestOptions,
  TypeDefShape,
  RetryConfig,
  QueryPromise,
  Mask,
  QUERY_ID,
} from './types.js';
import {
  QueryCacheOptions,
  QueryConfigOptions,
  LoadNextConfig,
  QueryClientContext,
  QueryContext,
  QueryParams,
  queryKeyFor,
  resolveBaseUrl,
} from './QueryClient.js';
import { ValidatorDef, t } from './typeDefs.js';
import { HasRequiredKeys, Optionalize, Signalize } from './type-utils.js';
import {
  createDefinitionProxy,
  extractDefinition,
  createExecutionContext as createExecutionContextUtil,
  reifyValue,
  type CapturedDefinition,
} from './fieldRef.js';

// ================================
// LoadNext types
// ================================

export interface ResolvedLoadNext {
  url?: string;
  searchParams?: Record<string, unknown>;
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
  abstract result: TypeDefShape;
  config?: QueryConfigOptions;

  declare context: QueryContext;
  declare response: Response | undefined;
  declare signal: AbortSignal;
  declare refetch: () => void;
  declare resultData: Record<string, unknown>;
  declare rawLoadNext: LoadNextConfig | undefined;

  abstract getStorageKey(): unknown;
  abstract send(): Promise<unknown>;

  getConfig?(): QueryConfigOptions | undefined;
  sendNext?(): Promise<unknown>;
  hasNext?(): boolean;

  constructor() {
    return createDefinitionProxy(this);
  }
}

// ================================
// RESTQuery
// ================================

export abstract class RESTQuery extends Query {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' = 'GET';
  path?: string;
  searchParams?: Record<string, unknown>;
  body?: Record<string, unknown>;
  headers?: HeadersInit;
  requestOptions?: QueryRequestOptions;
  loadNext?: LoadNextConfig;

  getStorageKey(): string {
    return `${this.method ?? 'GET'}:${this.path ?? ''}`;
  }

  getPath?(): string | undefined;
  getMethod?(): string;
  getSearchParams?(): Record<string, unknown> | undefined;
  getBody?(): Record<string, unknown> | undefined;
  getRequestOptions?(): QueryRequestOptions | undefined;
  getLoadNext?(): LoadNextConfig | undefined;

  async send(): Promise<unknown> {
    return this.executeRequest();
  }

  private resolveLoadNext(): ResolvedLoadNext | undefined {
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
    const resolved = this.resolveLoadNext();
    if (resolved === undefined) return false;

    if (resolved.url !== undefined && resolved.url !== null) {
      return true;
    }

    if (resolved.searchParams !== undefined) {
      const keys = Object.keys(resolved.searchParams);
      if (keys.length === 0) return false;
      for (const key of keys) {
        if (resolved.searchParams[key] === undefined || resolved.searchParams[key] === null) {
          return false;
        }
      }
      return true;
    }

    return false;
  }

  async sendNext(): Promise<unknown> {
    const resolved = this.resolveLoadNext();
    if (resolved === undefined) {
      throw new Error('loadNext is not configured for this query');
    }

    return this.executeRequest(resolved);
  }

  private async executeRequest(next?: { url?: string; searchParams?: Record<string, unknown> }): Promise<unknown> {
    const path = next?.url ?? (this.getPath ? this.getPath() : this.path);
    const method = this.getMethod ? this.getMethod() : this.method;
    const baseSearchParams = this.getSearchParams ? this.getSearchParams() : this.searchParams;
    const searchParams = next?.searchParams ? { ...baseSearchParams, ...next.searchParams } : baseSearchParams;
    const body = this.getBody ? this.getBody() : this.body;
    const requestOptions = this.getRequestOptions ? this.getRequestOptions() : this.requestOptions;

    if (!path) {
      throw new Error('RESTQuery requires a path. Define `path` as a field or override `getPath()`.');
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

    const { baseUrl: _baseUrl, signal: _signal, ...fetchOptions } = requestOptions ?? ({} as Record<string, unknown>);

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
      signal: this.signal,
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
  retryConfig: ResolvedRetryConfig;
}

export interface QueryDefinitionStatics {
  readonly id: string;
  /** Root entity shape. For non-entity results this is a synthetic EntityDef
   *  with QUERY_ID as idField. For entity results this is the entity's own
   *  ValidatorDef. */
  readonly shape: ValidatorDef<unknown>;
  readonly cache: QueryCacheOptions | undefined;
  /** Raw loadNext config with unresolved FieldRefs, extracted before reification. */
  readonly rawLoadNext: LoadNextConfig | undefined;
  /** Whether the query class implements sendNext(). */
  readonly hasSendNext: boolean;
  /** Whether the result shape is already an entity (vs synthetic wrapper). */
  readonly isEntityResult: boolean;
}

export class QueryDefinition<Params extends QueryParams | undefined, Result, StreamType> {
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
    const { methods } = this.captured;

    const config = methods.getConfig ? methods.getConfig.call(ctx) : ctx.config;
    const retryConfig = resolveRetryConfig(config?.retry);

    return { config, retryConfig };
  }

  static for(QueryClass: new () => Query): QueryDefinition<any, any, any> {
    let queryDefinition = queryDefCache.get(QueryClass);

    if (queryDefinition !== undefined) {
      return queryDefinition;
    }

    const instance = new QueryClass();
    const captured = extractDefinition(instance);

    const id = String(captured.methods.getStorageKey.call(captured.fields));
    const resultDef = captured.fields.result;
    const shape =
      resultDef instanceof ValidatorDef
        ? (resultDef as ValidatorDef<unknown>)
        : (t.object(resultDef) as unknown as ValidatorDef<unknown>);
    const isEntityResult = (shape.mask & Mask.ENTITY) !== 0;
    const cache = (QueryClass as typeof Query).cache;

    // Extract raw loadNext config before reification so FieldRefs survive
    const rawLoadNext = (captured.fields as unknown as Record<string, unknown>).loadNext as LoadNextConfig | undefined;
    const hasSendNext = typeof captured.methods.sendNext === 'function';

    // For entity results, the root entity IS the result entity.
    // For non-entity results, create a synthetic EntityDef with QUERY_ID as idField.
    const rootEntityShape = isEntityResult
      ? shape
      : new ValidatorDef(
          Mask.ENTITY | Mask.OBJECT,
          shape.shape,
          undefined,
          undefined,
          id, // typenameValue — unique per query class
          QUERY_ID, // idField — symbol, injected onto payload before parse
        );

    queryDefinition = new QueryDefinition(
      { id, shape: rootEntityShape, cache, rawLoadNext, hasSendNext, isEntityResult },
      captured,
    );

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
  ...args: HasRequiredKeys<ExtractType<T['params']>> extends true
    ? [params: Optionalize<Signalize<ExtractType<T['params']>>>]
    : [params?: Optionalize<Signalize<ExtractType<T['params']>>> | undefined]
): QueryPromise<T> {
  const queryDef = QueryDefinition.for(QueryClass);

  const queryClient = getContext(QueryClientContext);

  if (queryClient === undefined) {
    throw new Error('QueryClient not found');
  }

  const params = args[0] as QueryParams | undefined;

  return queryClient.getQuery(queryDef, params);
}
