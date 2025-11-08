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
} from './types.js';
import { QueryCacheOptions, QueryClientContext, QueryContext, QueryDefinition, QueryParams } from './QueryClient.js';
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

const listItems = infiniteQuery(() => ({
  path: '/items',
  method: 'GET',
  response: t.object({
    users: t.array(
      t.object({
        id: t.string,
        name: t.string,
      }),
    ),
  }),
  pagination: {
    getNextPageParams: lastPage => ({ cursor: 123 }),
  },
}));

const bQuery = infiniteQuery(() => ({
  path: '/users',
  method: 'GET',
  response: t.object({
    users: t.array(
      t.object({
        id: t.string,
        name: t.string,
      }),
    ),
  }),
  pagination: {
    getNextPageParams: lastPage => ({ cursor: 123 }),
  },
}));
