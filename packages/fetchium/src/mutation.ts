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
} from './types.js';
import { QueryClientContext, QueryContext } from './QueryClient.js';
import { t, ValidatorDef } from './typeDefs.js';
import { createPathInterpolator } from './pathInterpolator.js';
import { hashValue } from 'signalium/utils';
import { Prettify } from './type-utils.js';

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
// Mutation Definition Types
// ================================

export interface MutationCacheOptions {
  retry?: RetryConfig | number | false;
}

export interface MutationDefinition<Request, Response> {
  id: string;
  requestShape: InternalTypeDef;
  requestShapeKey: number;
  responseShape: InternalTypeDef;
  responseShapeKey: number;
  mutateFn: (context: QueryContext, request: Request) => Promise<Response>;
  optimisticUpdates: boolean;
  parseAndApply: ParseAndApply;
  cache?: MutationCacheOptions;
}

// ================================
// Mutation base class
// ================================

export abstract class Mutation {
  abstract readonly path: string;
  abstract readonly method: 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  abstract readonly request: ResponseTypeDef;
  abstract readonly response: ResponseTypeDef;
  optimisticUpdates?: boolean;
  parseAndApply?: ParseAndApply;
  cache?: MutationCacheOptions;
}

// ================================
// Type extraction from Mutation classes
// ================================

type ExtractMutationRequest<T extends Mutation> =
  T['request'] extends TypeDef<infer U>
    ? PathParams<T['path']> & U
    : T['request'] extends Record<string, TypeDef>
      ? PathParams<T['path']> & Prettify<{ [K in keyof T['request']]: ExtractType<T['request'][K]> }>
      : // eslint-disable-next-line @typescript-eslint/no-empty-object-type
        {};

type ExtractMutationResponse<T extends Mutation> =
  T['response'] extends TypeDef<infer U>
    ? U
    : T['response'] extends Record<string, TypeDef>
      ? Prettify<{ [K in keyof T['response']]: ExtractType<T['response'][K]> }>
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
// Internal: process a TypeDef into shape + shapeKey
// ================================

function processTypeDef(typeDef: Record<string, TypeDef> | TypeDef): {
  shape: InternalTypeDef;
  shapeKey: number;
} {
  let shape: InternalTypeDef;
  let shapeKey: number;

  if (typeof typeDef === 'object') {
    if (typeDef instanceof ValidatorDef) {
      shape = typeDef as InternalTypeDef;
      shapeKey = typeDef.shapeKey;
    } else if (typeDef instanceof Set) {
      shape = typeDef;
      shapeKey = hashValue(typeDef);
    } else {
      shape = t.object(typeDef as any) as unknown as InternalTypeDef;
      shapeKey = (shape as any).shapeKey;
    }
  } else {
    shape = typeDef as unknown as InternalTypeDef;
    shapeKey = hashValue(shape);
  }

  return { shape, shapeKey };
}

// ================================
// Internal: build mutation definition from class
// ================================

function getMutationDefinition(MutationClass: new () => Mutation): () => MutationDefinition<any, any> {
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

    const { path, method, request, response, optimisticUpdates = false, parseAndApply = 'both', cache } = instance;

    const id = `mutation:${method}:${path}`;

    const { shape: requestShape, shapeKey: requestShapeKey } = processTypeDef(request);
    const { shape: responseShape, shapeKey: responseShapeKey } = processTypeDef(response);

    const { interpolate: interpolatePath, pathParamNames } = createPathInterpolator(path);

    const mutateFn = async (context: QueryContext, requestData: unknown): Promise<unknown> => {
      const pathParams: Record<string, unknown> = {};
      for (const paramName of pathParamNames) {
        pathParams[paramName] = (requestData as Record<string, unknown>)[paramName];
      }
      const url = interpolatePath(pathParams);

      const fetchResponse = await context.fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestData),
      });

      return fetchResponse.json();
    };

    mutationDefinition = {
      id,
      requestShape,
      requestShapeKey,
      responseShape,
      responseShapeKey,
      mutateFn,
      optimisticUpdates,
      parseAndApply,
      cache,
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
): ReactiveTask<MutationResultValue<Readonly<ExtractMutationResponse<T>>>, [ExtractMutationRequest<T>]> {
  const getMutationDef = getMutationDefinition(MutationClass);

  const queryClient = getContext(QueryClientContext);

  if (queryClient === undefined) {
    throw new Error('QueryClient not found');
  }

  return queryClient.getMutation<any, any>(getMutationDef());
}
