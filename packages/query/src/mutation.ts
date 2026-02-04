import { getContext } from 'signalium';
import {
  MutationResult,
  MutationFn,
  Mask,
  ObjectFieldTypeDef,
  UnionDef,
  ExtractTypesFromObjectOrEntity,
  EntityDef,
  TypeDef,
  RetryConfig,
} from './types.js';
import { QueryClientContext, QueryContext } from './QueryClient.js';
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

// -----------------------------------------------------------------------------
// Mutation Definition Types
// -----------------------------------------------------------------------------

export interface MutationCacheOptions {
  /**
   * Retry configuration for failed mutations
   */
  retry?: RetryConfig | number | false;
}

export interface MutationDefinition<Request, Response> {
  id: string;
  requestShape: TypeDef;
  requestShapeKey: number;
  responseShape: TypeDef;
  responseShapeKey: number;
  mutateFn: (context: QueryContext, request: Request) => Promise<Response>;
  optimisticUpdates: boolean;
  cache?: MutationCacheOptions;
}

// Map for getting mutation definitions by function reference, for testing
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
const MUTATION_DEFINITION_MAP = new Map<Function, () => MutationDefinition<any, any>>();

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export const mutationKeyFor = (fn: Function): string => {
  const mutationDef = MUTATION_DEFINITION_MAP.get(fn);

  if (mutationDef === undefined) {
    throw new Error('Mutation definition not found');
  }

  return mutationDef().id;
};

// -----------------------------------------------------------------------------
// REST Mutation Definition
// -----------------------------------------------------------------------------

interface RESTMutationDefinition<
  Path extends string,
  RequestDef extends Record<string, ObjectFieldTypeDef> | ObjectFieldTypeDef,
  ResponseDef extends Record<string, ObjectFieldTypeDef> | ObjectFieldTypeDef,
> {
  /**
   * The URL path for the mutation. Supports path parameters like `/users/[id]`.
   */
  path: Path;
  /**
   * HTTP method for the mutation. Defaults to POST.
   */
  method?: 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  /**
   * TypeDef for the request body.
   */
  request: RequestDef;
  /**
   * TypeDef for the response body.
   */
  response: ResponseDef;
  /**
   * Whether to automatically apply optimistic updates.
   * When true, entities in the request will be immediately updated in the store
   * before the mutation completes, and reverted if the mutation fails.
   * Defaults to false.
   */
  optimisticUpdates?: boolean;
  /**
   * Cache options including retry configuration.
   */
  cache?: MutationCacheOptions;
}

type ExtractMutationRequest<
  Path extends string,
  RequestDef extends Record<string, ObjectFieldTypeDef> | ObjectFieldTypeDef,
> = PathParams<Path> & ExtractTypesFromObjectOrEntity<RequestDef>;

// -----------------------------------------------------------------------------
// Build Mutation Function
// -----------------------------------------------------------------------------

function processTypeDef(typeDef: Record<string, ObjectFieldTypeDef> | ObjectFieldTypeDef): {
  shape: TypeDef;
  shapeKey: number;
} {
  let shape: TypeDef;
  let shapeKey: number;

  if (typeof typeDef === 'object') {
    if (typeDef instanceof ValidatorDef) {
      shape = typeDef as TypeDef;
      shapeKey = typeDef.shapeKey;
    } else if (typeDef instanceof Set) {
      shape = typeDef;
      shapeKey = hashValue(typeDef);
    } else {
      shape = t.object(typeDef as Record<string, ObjectFieldTypeDef>);
      shapeKey = shape.shapeKey;
    }
  } else {
    shape = typeDef as Mask;
    shapeKey = hashValue(shape);
  }

  return { shape, shapeKey };
}

function buildMutationFn<Request, Response>(
  mutationDefinitionBuilder: () => RESTMutationDefinition<
    string,
    ObjectFieldTypeDef | Record<string, ObjectFieldTypeDef>,
    ObjectFieldTypeDef | Record<string, ObjectFieldTypeDef>
  >,
): () => MutationResult<Request, Response> {
  let mutationDefinition: MutationDefinition<Request, Response> | undefined;

  const getMutationDefinition = (): MutationDefinition<Request, Response> => {
    if (mutationDefinition === undefined) {
      const {
        path,
        method = 'POST',
        request,
        response,
        optimisticUpdates = false,
        cache,
      } = mutationDefinitionBuilder();

      const id = `mutation:${method}:${path}`;

      const { shape: requestShape, shapeKey: requestShapeKey } = processTypeDef(request);
      const { shape: responseShape, shapeKey: responseShapeKey } = processTypeDef(response);

      // Create optimized path interpolator (parses template once, also gives us path param names)
      const { interpolate: interpolatePath, pathParamNames } = createPathInterpolator(path);

      const mutateFn = async (context: QueryContext, requestData: Request): Promise<Response> => {
        // Only pass path params to the interpolator, not the full request
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
        cache,
      };
    }

    return mutationDefinition;
  };

  const mutationFn = (): MutationResult<Request, Response> => {
    const queryClient = getContext(QueryClientContext);

    if (queryClient === undefined) {
      throw new Error('QueryClient not found');
    }

    return queryClient.getMutation<Request, Response>(getMutationDefinition());
  };

  MUTATION_DEFINITION_MAP.set(mutationFn, getMutationDefinition);

  return mutationFn;
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

/**
 * Creates a mutation function that returns a MutationResult.
 * Mutations must be explicitly run via `.run(request)`.
 *
 * @example
 * ```ts
 * const updateUser = mutation(() => ({
 *   path: '/users/[id]',
 *   method: 'PUT',
 *   request: {
 *     id: t.id,
 *     name: t.string,
 *     email: t.string,
 *   },
 *   response: User,
 *   optimisticUpdates: true,
 * }));
 *
 * // Usage:
 * const mutation = updateUser();
 * await mutation.run({ id: '123', name: 'John', email: 'john@example.com' });
 * ```
 */
export function mutation<
  Path extends string,
  RequestDef extends Record<string, ObjectFieldTypeDef> | ObjectFieldTypeDef,
  ResponseDef extends Record<string, ObjectFieldTypeDef> | ObjectFieldTypeDef,
>(
  mutationDefinitionBuilder: () => RESTMutationDefinition<Path, RequestDef, ResponseDef>,
): MutationFn<ExtractMutationRequest<Path, RequestDef>, ResponseDef> {
  return buildMutationFn(mutationDefinitionBuilder as any) as any;
}
