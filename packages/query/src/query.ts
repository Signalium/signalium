import { getContext, reactive } from 'signalium';
import {
  APITypes,
  QueryResult,
  Mask,
  ObjectFieldTypeDef,
  UnionDef,
  QueryFn,
  InfiniteQueryFn,
  ExtractTypesFromObjectOrUndefined,
  EntityDef,
  StreamQueryFn,
} from './types.js';
import {
  QueryCacheOptions,
  QueryClientContext,
  QueryContext,
  QueryDefinition,
  QueryParams,
  StreamQueryDefinition,
  StreamCacheOptions,
  QueryType,
} from './QueryClient.js';
import { t, ValidatorDef } from './typeDefs.js';
import { createPathInterpolator } from './pathInterpolator.js';

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
  params?: Params;
  response: Response;
  subscribe: (
    params: ExtractTypesFromObjectOrUndefined<Params>,
    onUpdate: (update: Partial<ExtractTypesFromObjectOrUndefined<Response>>) => void,
  ) => () => void;
  cache?: StreamCacheOptions;
}

function buildQueryFn(
  queryDefinitionBuilder: (
    t: APITypes,
  ) =>
    | RESTQueryDefinition<string, SearchParamsDefinition, ObjectFieldTypeDef | Record<string, ObjectFieldTypeDef>>
    | InfiniteRESTQueryDefinition<
        string,
        SearchParamsDefinition,
        ObjectFieldTypeDef | Record<string, ObjectFieldTypeDef>
      >,
): QueryDefinition<QueryParams, unknown> {
  let queryDefinition: any | undefined;

  return reactive(
    (params: QueryParams | undefined): QueryResult<unknown> => {
      const queryClient = getContext(QueryClientContext);

      if (queryClient === undefined) {
        throw new Error('QueryClient not found');
      }

      if (queryDefinition === undefined) {
        const {
          path,
          method = 'GET',
          response,
          cache,
          pagination,
        } = queryDefinitionBuilder(t) as InfiniteRESTQueryDefinition<any, any, any>;

        const id = `${method}:${path}`;

        const shape: ObjectFieldTypeDef =
          typeof response === 'object' && !(response instanceof ValidatorDef)
            ? t.object(response as Record<string, ObjectFieldTypeDef>)
            : (response as ObjectFieldTypeDef);

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
          fetchFn,
          pagination,
          cache,
        };
      }

      return queryClient.getQuery<unknown>(queryDefinition, params);
    },
    // TODO: Getting a lot of type errors due to infinite recursion here.
    // For now, we return as any to coerce to the external type signature,
    // and internally we manage the difference.
  ) as any;
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

  return reactive((params: QueryParams | undefined): QueryResult<unknown> => {
    const queryClient = getContext(QueryClientContext);

    if (queryClient === undefined) {
      throw new Error('QueryClient not found');
    }

    if (streamDefinition === undefined) {
      const { response, subscribe, cache } = queryDefinitionBuilder();

      // Validate that response is an EntityDef
      if (!(response instanceof ValidatorDef) || (response.mask & Mask.ENTITY) === 0) {
        throw new Error('Stream query response must be an EntityDef');
      }

      // Generate a unique ID for the stream
      const id = `stream:${JSON.stringify(queryDefinitionBuilder.toString())}`;

      streamDefinition = {
        type: QueryType.Stream,
        id,
        shape: response as EntityDef,
        subscribeFn: (context: QueryContext, params: QueryParams | undefined, onUpdate: any) => {
          return (subscribe as any)(params as any, onUpdate);
        },
        cache,
      };
    }

    return queryClient.getQuery<unknown>(streamDefinition, params);
  }) as any;
}
