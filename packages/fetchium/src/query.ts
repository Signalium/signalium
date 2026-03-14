import { DiscriminatedReactivePromise, getContext } from 'signalium';
import {
  InternalTypeDef,
  ExtractType,
  TypeDef,
  QueryRequestOptions,
  ResponseTypeDef,
  ComplexTypeDef,
  RetryConfig,
  ExtractTypesFromObjectOrEntity,
  QueryResult,
  QueryPromise,
} from './types.js';
import {
  QueryCacheOptions,
  QueryClientContext,
  QueryContext,
  QueryParams,
  queryKeyFor,
  resolveBaseUrl,
} from './QueryClient.js';
import { t, ValidatorDef } from './typeDefs.js';
import { createPathInterpolator } from './pathInterpolator.js';
import { hashValue } from 'signalium/utils';
import { HasRequiredKeys, Optionalize, Signalize } from './type-utils.js';

// ================================
// Path param extraction types
// ================================

type IsParameter<Part> = Part extends `[${infer ParamName}]` ? ParamName : never;
type FilteredParts<Path> = Path extends `${infer PartA}/${infer PartB}`
  ? IsParameter<PartA> | FilteredParts<PartB>
  : IsParameter<Path>;
type ParamValue<Key> = Key extends `...${infer _Anything}` ? (string | number)[] : string | number;
type RemovePrefixDots<Key> = Key extends `...${infer Name}` ? Name : Key;
type PathParams<Path> = {
  [Key in FilteredParts<Path> as RemovePrefixDots<Key>]: ParamValue<Key>;
};

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
  retryOption: RetryConfig | number | false | undefined,
  isServer: boolean = typeof window === 'undefined',
): ResolvedRetryConfig {
  let retries: number;

  if (retryOption === false) {
    retries = 0;
  } else if (retryOption === undefined) {
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
// Generic params preserve literal types for searchParams/body so optional keys type-check (e.g. t.union(t.number, t.undefined)).
export abstract class Query<
  SearchParamsDef extends Record<string, TypeDef> = Record<string, TypeDef>,
  BodyDef extends Record<string, TypeDef> = Record<string, TypeDef>,
> {
  abstract readonly path: string;
  abstract readonly response: ResponseTypeDef;

  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' = 'GET';
  searchParams?: SearchParamsDef;
  body?: BodyDef;
  requestOptions?: QueryRequestOptions;
  cache?: QueryCacheOptions;
  stream?: StreamOptions;
  debounce?: number;
}

// ================================
// Query definition base class
// ================================

export class QueryDefinition<Params extends QueryParams | undefined, Result, StreamType> {
  constructor(
    public readonly id: string,
    public readonly shape: InternalTypeDef,
    public readonly shapeKey: number,
    public readonly fetchFn: (context: QueryContext, params: Params, prevResult?: Result) => Promise<Result>,
    public readonly debounce?: number,
    public readonly cache?: QueryCacheOptions,
    public readonly stream?: {
      shape: InternalTypeDef;
      shapeKey: number;
      subscribeFn: StreamSubscribeFn<Params, StreamType>;
    },
    public readonly retryConfig: ResolvedRetryConfig = resolveRetryConfig(cache?.retry),
  ) {}
}

// ================================
// Type extraction from Query classes
// ================================

type ExtractSearchParams<T extends Query> =
  T['searchParams'] extends Record<string, TypeDef>
    ? { [K in keyof T['searchParams']]: ExtractType<T['searchParams'][K]> }
    : unknown;

type ExtractBodyParams<T extends Query> =
  T['body'] extends Record<string, TypeDef> ? { [K in keyof T['body']]: ExtractType<T['body'][K]> } : unknown;

export type ExtractQueryParams<T extends Query> = PathParams<T['path']> & ExtractSearchParams<T> & ExtractBodyParams<T>;

// ================================
// Query definition cache and lookup
// ================================

const queryDefCache = new WeakMap<new () => Query, QueryDefinition<any, any, any>>();

export const queryKeyForClass = (cls: new () => Query, params: unknown): number => {
  const queryDef = getQueryDefinition(cls);

  return queryKeyFor(queryDef, params);
};

// ================================
// Internal: normalize a TypeDef into InternalTypeDef + shapeKey
// ================================

function resolveTypeDef(def: ResponseTypeDef): { shape: InternalTypeDef; shapeKey: number } {
  if (typeof def === 'object') {
    if (def instanceof ValidatorDef) {
      return { shape: def as InternalTypeDef, shapeKey: def.shapeKey };
    } else if (def instanceof Set) {
      return { shape: def, shapeKey: hashValue(def) };
    } else {
      const shape = t.object(def as any) as unknown as ComplexTypeDef;
      return { shape, shapeKey: shape.shapeKey };
    }
  }

  return { shape: def as unknown as InternalTypeDef, shapeKey: hashValue(def) };
}

// ================================
// Internal: build query definition from class
// ================================

const checkConflicts = (
  sourceNames: Set<string>,
  targetNames: Set<string>,
  sourceLabel: string,
  targetLabel: string,
) => {
  const conflicts = [...sourceNames].filter(name => targetNames.has(name));
  if (conflicts.length > 0) {
    throw new Error(
      `Query definition error: ${sourceLabel} [${conflicts.join(', ')}] conflict with ${targetLabel}. ` +
        `Please rename to avoid this conflict.`,
    );
  }
};

function getQueryDefinition(QueryClass: new () => Query): QueryDefinition<any, any, any> {
  let queryDefinition = queryDefCache.get(QueryClass);

  if (queryDefinition !== undefined) {
    return queryDefinition;
  }

  const userDefinition = new QueryClass();

  const { path, method, searchParams, body, response, requestOptions, cache, stream, debounce } = userDefinition;

  const id = `${method}:${path}`;

  const { shape, shapeKey } = resolveTypeDef(response);

  const { interpolate: interpolatePath, pathParamNames } = createPathInterpolator(path);

  const bodyParamNames = new Set<string>();
  const hasBody =
    body !== undefined && typeof body === 'object' && !(body instanceof ValidatorDef) && !(body instanceof Set);
  if (hasBody) {
    for (const key of Object.keys(body as Record<string, unknown>)) {
      bodyParamNames.add(key);
    }
  }

  const searchParamNames = new Set(
    searchParams &&
    typeof searchParams === 'object' &&
    !(searchParams instanceof ValidatorDef) &&
    !(searchParams instanceof Set)
      ? Object.keys(searchParams)
      : [],
  );

  if (IS_DEV) {
    checkConflicts(searchParamNames, pathParamNames, 'Search param(s)', `path parameter(s) in "${path}"`);
    checkConflicts(bodyParamNames, pathParamNames, 'Body field(s)', `path parameter(s) in "${path}"`);
    checkConflicts(bodyParamNames, searchParamNames, 'Body field(s)', 'search param(s)');
  }

  const fetchFn = async (context: QueryContext, params: QueryParams) => {
    let bodyData: Record<string, unknown> | undefined;
    let urlParams: QueryParams | undefined = params;

    if (hasBody) {
      bodyData = {};
      urlParams = params !== undefined ? {} : undefined;
      if (params !== undefined) {
        for (const key in params) {
          if (bodyParamNames.has(key)) {
            bodyData[key] = params[key];
          } else {
            (urlParams as Record<string, unknown>)[key] = params[key];
          }
        }
      }
    }

    const interpolatedPath = interpolatePath(urlParams ?? {});

    const baseUrl = resolveBaseUrl(requestOptions?.baseUrl) ?? resolveBaseUrl(context.baseUrl);
    const fullUrl = baseUrl ? `${baseUrl}${interpolatedPath}` : interpolatedPath;

    const { baseUrl: _baseUrl, headers: userHeaders, ...fetchOptions } = requestOptions ?? {};

    const headers: HeadersInit | undefined = bodyData
      ? { 'Content-Type': 'application/json', ...userHeaders }
      : userHeaders;

    const fetchResponse = await context.fetch(fullUrl, {
      method,
      headers,
      body: bodyData ? JSON.stringify(bodyData) : undefined,
      ...fetchOptions,
    });

    return fetchResponse.json();
  };

  let streamConfig: ResolvedStreamOptions | undefined = undefined;
  if (stream) {
    const { shape: streamShape, shapeKey: streamShapeKey } = resolveTypeDef(stream.type);

    streamConfig = {
      shape: streamShape,
      shapeKey: streamShapeKey,
      subscribeFn: (context: QueryContext, params: QueryParams | undefined, onUpdate: any) => {
        return (stream.subscribe as any)(context, params as any, onUpdate);
      },
    };
  }

  const retryConfig = resolveRetryConfig(cache?.retry);

  queryDefinition = new QueryDefinition(id, shape, shapeKey, fetchFn, debounce, cache, streamConfig, retryConfig);

  queryDefCache.set(QueryClass, queryDefinition);
  return queryDefinition;
}

// ================================
// Public API
// ================================

export function getQuery<T extends Query>(
  QueryClass: new () => T,
  ...args: HasRequiredKeys<ExtractQueryParams<T>> extends true
    ? [params: Optionalize<Signalize<ExtractQueryParams<T>>>]
    : [params?: Optionalize<Signalize<ExtractQueryParams<T>>> | undefined]
): QueryPromise<T> {
  const queryDef = getQueryDefinition(QueryClass);

  const queryClient = getContext(QueryClientContext);

  if (queryClient === undefined) {
    throw new Error('QueryClient not found');
  }

  const params = args[0] as QueryParams | undefined;

  return queryClient.getQuery(queryDef, params);
}
