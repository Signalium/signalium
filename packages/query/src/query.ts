import { getContext, reactive } from 'signalium';
import {
  QueryResult,
  Mask,
  ObjectFieldTypeDef,
  UnionDef,
  QueryFn,
  InfiniteQueryFn,
  ExtractTypesFromObjectOrUndefined,
  EntityDef,
  StreamQueryFn,
  TypeDef,
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
} from './QueryClient.js';
import { t, ValidatorDef } from './typeDefs.js';
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

type SearchParamsType = Mask.NUMBER | Mask.STRING | Set<string | boolean | number>;
type SearchParamsDefinition = Record<string, SearchParamsType | UnionDef<SearchParamsType[]>>;

// Map for getting query definitions by function reference, for testing
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
const QUERY_DEFINITION_MAP = new Map<Function, () => QueryDefinition<any, any>>();

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export const queryKeyForFn = (fn: Function, params: unknown): number => {
  const queryDef = QUERY_DEFINITION_MAP.get(fn);

  if (queryDef === undefined) {
    throw new Error('Query definition not found');
  }

  return queryKeyFor(queryDef(), params);
};

/**
 * BIG TODO:
 *
 * All of the `any` types in this file need to be removed, but we need to figure
 * out why we're getting so many infinite recursion errors with types first. When
 * we remove them, the types should work without the `any`s.
 */

interface RESTQueryDefinition<
  Path extends string,
  SearchParams extends Record<string, ObjectFieldTypeDef>,
  ResponseDef extends Record<string, ObjectFieldTypeDef> | ObjectFieldTypeDef,
> {
  path: Path;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  searchParams?: SearchParams;
  response: ResponseDef;

  cache?: QueryCacheOptions;
}

interface InfiniteRESTQueryDefinition<
  Path extends string,
  SearchParams extends Record<string, ObjectFieldTypeDef>,
  ResponseDef extends Record<string, ObjectFieldTypeDef> | ObjectFieldTypeDef,
> extends RESTQueryDefinition<Path, SearchParams, ResponseDef> {
  pagination: {
    getNextPageParams?(
      lastPage: ExtractTypesFromObjectOrUndefined<ResponseDef>,
      params?: ExtractTypesFromObjectOrUndefined<SearchParams> | undefined,
    ): QueryParams | undefined;
  };
}

type ExtractQueryParams<Path extends string, SearchParams extends SearchParamsDefinition> = PathParams<Path> &
  ExtractTypesFromObjectOrUndefined<SearchParams>;

interface StreamQueryDefinitionBuilder<
  Params extends SearchParamsDefinition,
  Response extends Record<string, ObjectFieldTypeDef> | ObjectFieldTypeDef,
> {
  id: string;
  params?: Params;
  response: Response;
  subscribe: (
    params: ExtractTypesFromObjectOrUndefined<Params>,
    onUpdate: (update: Partial<ExtractTypesFromObjectOrUndefined<Response>>) => void,
  ) => () => void;
  cache?: StreamCacheOptions;
}

function buildQueryFn(
  queryDefinitionBuilder: () =>
    | RESTQueryDefinition<string, SearchParamsDefinition, ObjectFieldTypeDef | Record<string, ObjectFieldTypeDef>>
    | InfiniteRESTQueryDefinition<
        string,
        SearchParamsDefinition,
        ObjectFieldTypeDef | Record<string, ObjectFieldTypeDef>
      >,
): QueryDefinition<QueryParams, unknown> {
  let queryDefinition: any | undefined;

  const getQueryDefinition = () => {
    if (queryDefinition === undefined) {
      const {
        path,
        method = 'GET',
        response,
        cache,
        pagination,
      } = queryDefinitionBuilder() as InfiniteRESTQueryDefinition<any, any, any>;

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

      // Create optimized path interpolator (parses template once)
      const interpolatePath = createPathInterpolator(path);

      const fetchFn = async (context: QueryContext, params: QueryParams) => {
        // Interpolate path params and append search params automatically
        const url = interpolatePath(params);

        const response = await context.fetch(url, {
          method,
        });

        return response.json();
      };

      queryDefinition = {
        type: pagination ? QueryType.InfiniteQuery : QueryType.Query,
        id,
        shape,
        shapeKey,
        fetchFn,
        pagination,
        cache,
      };
    }

    return queryDefinition;
  };

  const queryFn = reactive(
    (params: QueryParams | undefined): QueryResult<unknown> => {
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
  SearchParams extends SearchParamsDefinition,
  Response extends Record<string, ObjectFieldTypeDef> | ObjectFieldTypeDef,
>(
  queryDefinitionBuilder: () => RESTQueryDefinition<Path, SearchParams, Response>,
): QueryFn<ExtractQueryParams<Path, SearchParams>, Response> {
  return buildQueryFn(queryDefinitionBuilder) as any;
}

export function infiniteQuery<
  Path extends string,
  SearchParams extends SearchParamsDefinition,
  Response extends Record<string, ObjectFieldTypeDef> | ObjectFieldTypeDef,
>(
  queryDefinitionBuilder: () => InfiniteRESTQueryDefinition<Path, SearchParams, Response>,
): InfiniteQueryFn<ExtractQueryParams<Path, SearchParams>, Response> {
  return buildQueryFn(queryDefinitionBuilder) as any;
}

export function streamQuery<
  // TODO: This is a hack to get the type signature to work. We should find a better way to do this.
  Path extends '',
  Params extends SearchParamsDefinition,
  Response extends Record<string, ObjectFieldTypeDef> | ObjectFieldTypeDef,
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

  const streamFn = reactive((params: QueryParams | undefined): QueryResult<unknown> => {
    const queryClient = getContext(QueryClientContext);

    if (queryClient === undefined) {
      throw new Error('QueryClient not found');
    }

    return queryClient.getQuery<unknown>(getStreamDefinition(), params);
  }) as any;

  QUERY_DEFINITION_MAP.set(streamFn, getStreamDefinition);

  return streamFn;
}
