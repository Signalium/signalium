import { getContext, reactive } from 'signalium';
import {
  APITypes,
  ArrayDef,
  DiscriminatedQueryResult,
  EntityDef,
  Mask,
  ObjectDef,
  RecordDef,
  ObjectFieldTypeDef,
  UnionDef,
} from './types.js';
import { QueryCacheOptions, QueryClientContext, QueryContext, QueryDefinition } from './QueryClient.js';
import { entity, t, ValidatorDef } from './typeDefs.js';
import { createPathInterpolator } from './pathInterpolator.js';

type ExtractPrimitiveTypeFromMask<T extends number> = T extends Mask.UNDEFINED
  ? undefined
  : T extends Mask.NULL
    ? null
    : T extends Mask.NUMBER
      ? number
      : T extends Mask.STRING
        ? string
        : T extends Mask.BOOLEAN
          ? boolean
          : T extends Mask.ID
            ? string
            : never;

export type ExtractType<T extends ObjectFieldTypeDef | string> = T extends number
  ? ExtractPrimitiveTypeFromMask<T>
  : T extends string
    ? T
    : T extends Set<infer TSet>
      ? TSet
      : T extends ObjectDef<infer S>
        ? Prettify<ExtractTypesFromShape<S>>
        : T extends EntityDef<infer S>
          ? Prettify<ExtractTypesFromShape<S>>
          : T extends ArrayDef<infer S>
            ? ExtractType<S>[]
            : T extends RecordDef<infer S>
              ? Record<string, ExtractType<S>>
              : T extends UnionDef<infer VS>
                ? ExtractType<VS[number]>
                : never;

type ExtractTypesFromShape<S extends Record<string, ObjectFieldTypeDef | string>> = {
  [K in keyof S]: ExtractType<S[K]>;
};

type IsParameter<Part> = Part extends `[${infer ParamName}]` ? ParamName : never;
type FilteredParts<Path> = Path extends `${infer PartA}/${infer PartB}`
  ? IsParameter<PartA> | FilteredParts<PartB>
  : IsParameter<Path>;
type ParamValue<Key> = Key extends `...${infer Anything}` ? (string | number)[] : string | number;
type RemovePrefixDots<Key> = Key extends `...${infer Name}` ? Name : Key;
type PathParams<Path> = {
  [Key in FilteredParts<Path> as RemovePrefixDots<Key>]: ParamValue<Key>;
};

interface RESTQueryDefinition {
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  searchParams?: Record<string, ObjectFieldTypeDef>;
  response: Record<string, ObjectFieldTypeDef> | ObjectFieldTypeDef;

  cache?: QueryCacheOptions;
}

type ExtractTypesFromObjectOrTypeDef<S extends Record<string, ObjectFieldTypeDef> | ObjectFieldTypeDef | undefined> =
  S extends Record<string, ObjectFieldTypeDef>
    ? {
        [K in keyof S]: ExtractType<S[K]>;
      }
    : S extends ObjectFieldTypeDef
      ? ExtractType<S>
      : // eslint-disable-next-line @typescript-eslint/no-empty-object-type
        {};

type QueryParams<QDef extends RESTQueryDefinition> = PathParams<QDef['path']> &
  ExtractTypesFromObjectOrTypeDef<QDef['searchParams']>;

type QueryParamsOrUndefined<QDef extends RESTQueryDefinition> =
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  {} extends QueryParams<QDef> ? undefined : QueryParams<QDef>;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type HasRequiredKeys<T> = {} extends T ? false : { [K in keyof T]: undefined } extends T ? false : true;

type Optionalize<T> = T extends object
  ? {
      -readonly [K in keyof T as undefined extends T[K] ? never : K]: T[K];
    } & {
      -readonly [K in keyof T as undefined extends T[K] ? K : never]?: T[K];
    }
  : T;

type Prettify<T> = T extends object
  ? {
      -readonly [K in keyof T]: T[K];
    } & {}
  : T;

export function query<const QDef extends RESTQueryDefinition>(
  queryDefinitionBuilder: (t: APITypes) => QDef,
): (
  ...args: HasRequiredKeys<QueryParams<QDef>> extends true
    ? [params: Prettify<Optionalize<QueryParams<QDef>>>]
    : [params?: Prettify<Optionalize<QueryParamsOrUndefined<QDef>>>]
) => DiscriminatedQueryResult<Readonly<Prettify<ExtractTypesFromObjectOrTypeDef<QDef['response']>>>> {
  let queryDefinition:
    | QueryDefinition<Record<string, unknown>, ExtractTypesFromObjectOrTypeDef<QDef['response']>>
    | undefined;

  return reactive(
    (params: Record<string, unknown>): DiscriminatedQueryResult<ExtractTypesFromObjectOrTypeDef<QDef['response']>> => {
      const queryClient = getContext(QueryClientContext);

      if (queryClient === undefined) {
        throw new Error('QueryClient not found');
      }

      if (queryDefinition === undefined) {
        const { path, method = 'GET', response, cache } = queryDefinitionBuilder(t);

        const id = `${method}:${path}`;

        const shape: ObjectFieldTypeDef =
          typeof response === 'object' && !(response instanceof ValidatorDef)
            ? t.object(response as Record<string, ObjectFieldTypeDef>)
            : (response as ObjectFieldTypeDef);

        // Create optimized path interpolator (parses template once)
        const interpolatePath = createPathInterpolator(path);

        const fetchFn = async (context: QueryContext, params: Record<string, unknown>) => {
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
          cache,
        };
      }

      return queryClient.getQuery(queryDefinition, params);
    },
    // TODO: Getting a lot of type errors due to infinite recursion here.
    // For now, we return as any to coerce to the external type signature,
    // and internally we manage the difference.
  ) as any;
}
