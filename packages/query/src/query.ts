import { getContext, reactive } from 'signalium';
import {
  QueryResult,
  Mask,
  ObjectFieldTypeDef,
  UnionDef,
  QueryFn,
  InfiniteQueryFn,
  ExtractTypesFromObjectOrEntity,
  ExtractType,
  EntityDef,
  StreamQueryFn,
  TypeDef,
  QueryRequestOptions,
} from './types.js';
import {
  QueryCacheOptions,
  QueryClientContext,
  QueryContext,
  QueryDefinition,
  QueryParams,
  StreamCacheOptions,
  QueryType,
  queryKeyFor,
  resolveBaseUrl,
} from './QueryClient.js';
import { entity, t, ValidatorDef } from './typeDefs.js';
import { createPathInterpolator } from './pathInterpolator.js';
import { hashValue } from 'signalium/utils';

type IsParameter<Part> = Part extends `[${infer ParamName}]` ? ParamName : never;
type FilteredParts<Path> = Path extends `${infer PartA}/${infer PartB}`
  ? IsParameter<PartA> | FilteredParts<PartB>
  : IsParameter<Path>;
type ParamValue<Key> = Key extends `...${infer Anything}` ? (string | number)[] : string | number;
type RemovePrefixDots<Key> = Key extends `...${infer Name}` ? Name : Key;
type PathParams<Path> = {
  [Key in FilteredParts<Path> as RemovePrefixDots<Key>]: ParamValue<Key>;
};

type SearchParamsType =
  | Mask.NUMBER
  | Mask.STRING
  | Mask.BOOLEAN
  | Mask.UNDEFINED
  | Mask.NULL
  | Set<string | boolean | number>;
type SearchParamsDefinition = Record<string, SearchParamsType | UnionDef<SearchParamsType[]>>;

interface StreamOptions<
  Params extends SearchParamsDefinition,
  Event extends Record<string, ObjectFieldTypeDef> | ObjectFieldTypeDef,
> {
  type: Event;
  subscribe: (
    context: QueryContext,
    params: ExtractTypesFromObjectOrEntity<Params>,
    onUpdate: (update: Partial<ExtractTypesFromObjectOrEntity<Event>>) => void,
  ) => () => void;
}

// Map for getting query definitions by function reference, for testing
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
const QUERY_DEFINITION_MAP = new Map<Function, () => QueryDefinition<any, any, any>>();

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export const queryKeyForFn = (fn: Function, params: unknown): number => {
  const queryDef = QUERY_DEFINITION_MAP.get(fn);

  if (queryDef === undefined) {
    throw new Error('Query definition not found');
  }

  return queryKeyFor(queryDef(), params);
};

interface OptimisticInsertOptions<OptimisticInsertDef extends EntityDef | UnionDef<EntityDef[]>> {
  type: OptimisticInsertDef;
}

/**
 * BIG TODO:
 *
 * All of the `any` types in this file need to be removed, but we need to figure
 * out why we're getting so many infinite recursion errors with types first. When
 * we remove them, the types should work without the `any`s.
 */
type BodyDefinition = Record<string, ObjectFieldTypeDef>;

interface RESTQueryDefinition<
  Path extends string,
  SearchParams extends SearchParamsDefinition,
  BodyDef extends BodyDefinition | undefined,
  ResponseDef extends Record<string, ObjectFieldTypeDef> | ObjectFieldTypeDef,
  StreamEntityDef extends EntityDef | UnionDef<EntityDef[]> | undefined = undefined,
  OptimisticInsertDef extends EntityDef | UnionDef<EntityDef[]> | undefined = undefined,
> {
  path: Path;
  method?: 'GET' | 'POST';
  searchParams?: SearchParams;
  body?: BodyDef;
  response: ResponseDef;
  requestOptions?: QueryRequestOptions;
  cache?: QueryCacheOptions;
  stream?: StreamEntityDef extends EntityDef | UnionDef<EntityDef[]>
    ? StreamOptions<SearchParams, StreamEntityDef>
    : undefined;
  optimisticInserts?: OptimisticInsertDef extends EntityDef | UnionDef<EntityDef[]>
    ? OptimisticInsertOptions<OptimisticInsertDef>
    : undefined;
  debounce?: number;
}

interface InfiniteRESTQueryDefinition<
  Path extends string,
  SearchParams extends SearchParamsDefinition,
  BodyDef extends BodyDefinition | undefined,
  ResponseDef extends Record<string, ObjectFieldTypeDef> | ObjectFieldTypeDef,
  StreamEntityDef extends EntityDef | UnionDef<EntityDef[]> | undefined = undefined,
  OptimisticInsertDef extends EntityDef | UnionDef<EntityDef[]> | undefined = undefined,
> {
  path: Path;
  method?: 'GET' | 'POST';
  searchParams?: SearchParams;
  body?: BodyDef;
  response: ResponseDef;
  requestOptions?: QueryRequestOptions;
  cache?: QueryCacheOptions;
  stream?: StreamEntityDef extends EntityDef | UnionDef<EntityDef[]>
    ? StreamOptions<SearchParams, StreamEntityDef>
    : undefined;
  optimisticInserts?: OptimisticInsertDef extends EntityDef | UnionDef<EntityDef[]>
    ? OptimisticInsertOptions<OptimisticInsertDef>
    : undefined;
  pagination: {
    getNextPageParams?(
      lastPage: ExtractTypesFromObjectOrEntity<ResponseDef>,
      params?: ExtractTypesFromObjectOrEntity<SearchParams> | undefined,
    ): QueryParams | undefined;
  };
  debounce?: number;
}

// Helper type to extract body params - uses unknown for false branch to simplify intersections
type ExtractBodyParams<BodyDef> = BodyDef extends BodyDefinition
  ? { [K in keyof BodyDef]: ExtractType<BodyDef[K]> }
  : unknown;

// Extracts all query parameters from path, search params, and body definition
type ExtractQueryParams<
  Path extends string,
  SearchParams extends SearchParamsDefinition,
  BodyDef extends BodyDefinition | undefined = undefined,
> = PathParams<Path> & ExtractTypesFromObjectOrEntity<SearchParams> & ExtractBodyParams<BodyDef>;

interface StreamQueryDefinitionBuilder<
  Params extends SearchParamsDefinition,
  Response extends Record<string, ObjectFieldTypeDef> | ObjectFieldTypeDef,
> {
  id: string;
  params?: Params;
  response: Response;
  subscribe: (
    params: ExtractTypesFromObjectOrEntity<Params>,
    onUpdate: (update: Partial<ExtractTypesFromObjectOrEntity<Response>>) => void,
  ) => () => void;
  cache?: StreamCacheOptions;
}

function buildQueryFn(
  queryDefinitionBuilder: () =>
    | RESTQueryDefinition<
        string,
        SearchParamsDefinition,
        BodyDefinition | undefined,
        ObjectFieldTypeDef | Record<string, ObjectFieldTypeDef>,
        EntityDef | UnionDef<EntityDef[]>
      >
    | InfiniteRESTQueryDefinition<
        string,
        SearchParamsDefinition,
        BodyDefinition | undefined,
        ObjectFieldTypeDef | Record<string, ObjectFieldTypeDef>,
        EntityDef | UnionDef<EntityDef[]>
      >,
): QueryDefinition<QueryParams, unknown, unknown> {
  let queryDefinition: any | undefined;

  const getQueryDefinition = () => {
    if (queryDefinition === undefined) {
      const {
        path,
        method = 'GET',
        searchParams,
        body,
        response,
        requestOptions,
        cache,
        pagination,
        stream,
        optimisticInserts,
        debounce,
      } = queryDefinitionBuilder() as InfiniteRESTQueryDefinition<any, any, any, any, any, any>;

      const id = `${method}:${path}`;

      let shape: TypeDef;
      let shapeKey: number;

      if (typeof response === 'object') {
        if (response instanceof ValidatorDef) {
          shape = response as TypeDef;
          shapeKey = response.shapeKey;
        } else if (response instanceof Set) {
          shape = response;
          shapeKey = hashValue(response);
        } else {
          shape = t.object(response as Record<string, ObjectFieldTypeDef>);
          shapeKey = shape.shapeKey;
        }
      } else {
        shape = response as Mask;
        shapeKey = hashValue(shape);
      }

      // Create optimized path interpolator (parses template once, also gives us path param names)
      const { interpolate: interpolatePath, pathParamNames } = createPathInterpolator(path);

      // Extract body field names from body definition (done once at definition time)
      const bodyParamNames = new Set<string>();
      const hasBody =
        body !== undefined && typeof body === 'object' && !(body instanceof ValidatorDef) && !(body instanceof Set);
      if (hasBody) {
        for (const key of Object.keys(body as Record<string, ObjectFieldTypeDef>)) {
          bodyParamNames.add(key);
        }
      }

      // Extract search param names from searchParams definition (done once at definition time)
      const searchParamNames = new Set(
        searchParams && typeof searchParams === 'object' && !(searchParams instanceof ValidatorDef) && !(searchParams instanceof Set)
          ? Object.keys(searchParams)
          : [],
      );

      // Check for naming conflicts between path params, search params, and body fields
      const checkConflicts = (sourceNames: Set<string>, targetNames: Set<string>, sourceLabel: string, targetLabel: string) => {
        const conflicts = [...sourceNames].filter(name => targetNames.has(name));
        if (conflicts.length > 0) {
          throw new Error(
            `Query definition error: ${sourceLabel} [${conflicts.join(', ')}] conflict with ${targetLabel}. ` +
              `Please rename to avoid this conflict.`,
          );
        }
      };

      checkConflicts(searchParamNames, pathParamNames, 'Search param(s)', `path parameter(s) in "${path}"`);
      checkConflicts(bodyParamNames, pathParamNames, 'Body field(s)', `path parameter(s) in "${path}"`);
      checkConflicts(bodyParamNames, searchParamNames, 'Body field(s)', 'search param(s)');

      const fetchFn = async (context: QueryContext, params: QueryParams) => {
        // Separate body params from URL params (path + search params)
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

        // Interpolate path params and append search params automatically
        const interpolatedPath = interpolatePath(urlParams ?? {});

        // Resolve baseUrl: query-level requestOptions overrides context-level
        const baseUrl = resolveBaseUrl(requestOptions?.baseUrl) ?? resolveBaseUrl(context.baseUrl);
        const fullUrl = baseUrl ? `${baseUrl}${interpolatedPath}` : interpolatedPath;

        // Extract request init options (excluding baseUrl which is not a valid RequestInit property)
        const { baseUrl: _baseUrl, headers: userHeaders, ...fetchOptions } = requestOptions ?? {};

        // Merge headers, adding Content-Type for body requests
        const headers: HeadersInit | undefined = bodyData
          ? { 'Content-Type': 'application/json', ...userHeaders }
          : userHeaders;

        const response = await context.fetch(fullUrl, {
          method,
          headers,
          body: bodyData ? JSON.stringify(bodyData) : undefined,
          ...fetchOptions,
        });

        return response.json();
      };

      // Process stream configuration if provided
      let streamConfig: any = undefined;
      if (stream) {
        let streamShape: TypeDef;
        let streamShapeKey: number;

        const eventDef = stream.type;

        if (typeof eventDef === 'object') {
          if (eventDef instanceof ValidatorDef) {
            streamShape = eventDef as TypeDef;
            streamShapeKey = eventDef.shapeKey;
          } else if (eventDef instanceof Set) {
            streamShape = eventDef;
            streamShapeKey = hashValue(eventDef);
          } else {
            streamShape = t.object(eventDef as Record<string, ObjectFieldTypeDef>);
            streamShapeKey = streamShape.shapeKey;
          }
        } else {
          streamShape = eventDef as Mask;
          streamShapeKey = hashValue(streamShape);
        }

        streamConfig = {
          shape: streamShape,
          shapeKey: streamShapeKey,
          subscribeFn: (context: QueryContext, params: QueryParams | undefined, onUpdate: any) => {
            return (stream.subscribe as any)(context, params as any, onUpdate);
          },
        };
      }

      // Process optimistic inserts configuration if provided
      let optimisticInsertsConfig: any = undefined;
      if (optimisticInserts) {
        let insertShape: TypeDef;
        let insertShapeKey: number;

        const insertDef = optimisticInserts.type;

        if (typeof insertDef === 'object') {
          if (insertDef instanceof ValidatorDef) {
            insertShape = insertDef as TypeDef;
            insertShapeKey = insertDef.shapeKey;
          } else if (insertDef instanceof Set) {
            insertShape = insertDef;
            insertShapeKey = hashValue(insertDef);
          } else {
            insertShape = t.object(insertDef as Record<string, ObjectFieldTypeDef>);
            insertShapeKey = insertShape.shapeKey;
          }
        } else {
          insertShape = insertDef as Mask;
          insertShapeKey = hashValue(insertShape);
        }

        optimisticInsertsConfig = {
          shape: insertShape,
          shapeKey: insertShapeKey,
        };
      }

      queryDefinition = {
        type: pagination ? QueryType.InfiniteQuery : QueryType.Query,
        id,
        shape,
        shapeKey,
        fetchFn,
        pagination,
        cache,
        stream: streamConfig,
        optimisticInserts: optimisticInsertsConfig,
        debounce,
      };
    }

    return queryDefinition;
  };

  const queryFn = reactive(
    (params: QueryParams | undefined): QueryResult<unknown, unknown, unknown> => {
      const queryClient = getContext(QueryClientContext);

      if (queryClient === undefined) {
        throw new Error('QueryClient not found');
      }

      return queryClient.getQuery<unknown>(getQueryDefinition(), params);
    },
    // TODO: Getting a lot of type errors due to infinite recursion here.
    // For now, we return as any to coerce to the external type signature,
    // and internally we manage the difference.
  ) as any;

  QUERY_DEFINITION_MAP.set(queryFn, getQueryDefinition);

  return queryFn;
}

export function query<
  Path extends string,
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  SearchParams extends SearchParamsDefinition = {},
  BodyDef extends BodyDefinition | undefined = undefined,
  Response extends Record<string, ObjectFieldTypeDef> | ObjectFieldTypeDef = Record<string, ObjectFieldTypeDef>,
  EventDef extends EntityDef | UnionDef<EntityDef[]> | undefined = undefined,
  OptimisticUpdateDef extends EntityDef | UnionDef<EntityDef[]> | undefined = undefined,
>(
  queryDefinitionBuilder: () => RESTQueryDefinition<
    Path,
    SearchParams,
    BodyDef,
    Response,
    EventDef,
    OptimisticUpdateDef
  >,
): QueryFn<ExtractQueryParams<Path, SearchParams, BodyDef>, Response, EventDef, OptimisticUpdateDef> {
  return buildQueryFn(queryDefinitionBuilder as any) as any;
}

export function infiniteQuery<
  Path extends string,
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  SearchParams extends SearchParamsDefinition = {},
  BodyDef extends BodyDefinition | undefined = undefined,
  Response extends Record<string, ObjectFieldTypeDef> | ObjectFieldTypeDef = Record<string, ObjectFieldTypeDef>,
  EventDef extends EntityDef | UnionDef<EntityDef[]> | undefined = undefined,
  OptimisticInsertDef extends EntityDef | UnionDef<EntityDef[]> | undefined = undefined,
>(
  queryDefinitionBuilder: () => InfiniteRESTQueryDefinition<
    Path,
    SearchParams,
    BodyDef,
    Response,
    EventDef,
    OptimisticInsertDef
  >,
): InfiniteQueryFn<ExtractQueryParams<Path, SearchParams, BodyDef>, Response, EventDef, OptimisticInsertDef> {
  return buildQueryFn(queryDefinitionBuilder as any) as any;
}

export function streamQuery<
  // TODO: This is a hack to get the type signature to work. We should find a better way to do this.
  Path extends '',
  Params extends SearchParamsDefinition,
  Response extends EntityDef | UnionDef<EntityDef[]>,
>(
  queryDefinitionBuilder: () => StreamQueryDefinitionBuilder<Params, Response>,
): StreamQueryFn<ExtractQueryParams<Path, Params>, Response> {
  let streamDefinition: any | undefined;

  const getStreamDefinition = () => {
    if (streamDefinition === undefined) {
      const { id, response, subscribe, cache } = queryDefinitionBuilder();

      // Validate that response is an EntityDef
      if (!(response instanceof ValidatorDef) || (response.mask & Mask.ENTITY) === 0) {
        throw new Error('Stream query response must be an EntityDef');
      }

      streamDefinition = {
        type: QueryType.Stream,
        id,
        shape: response as EntityDef,
        shapeKey: response.shapeKey,
        subscribeFn: (context: QueryContext, params: QueryParams | undefined, onUpdate: any) => {
          return (subscribe as any)(params as any, onUpdate);
        },
        cache,
      };
    }
    return streamDefinition;
  };

  const streamFn = reactive((params: QueryParams | undefined): QueryResult<unknown, unknown, unknown> => {
    const queryClient = getContext(QueryClientContext);

    if (queryClient === undefined) {
      throw new Error('QueryClient not found');
    }

    return queryClient.getQuery<unknown>(getStreamDefinition(), params);
  }) as any;

  QUERY_DEFINITION_MAP.set(streamFn, getStreamDefinition);

  return streamFn;
}
