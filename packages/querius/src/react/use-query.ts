import { useReactive } from 'signalium/react';
import { reactive, DiscriminatedReactivePromise } from 'signalium';
import { ExtractTypesFromObjectOrEntity, QueryPromise, QueryResult, QueryResult as QueryResultType } from '../types.js';
import { ExtractQueryParams, getQuery, Query } from '../query.js';
import { HasRequiredKeys, Optionalize, Signalize } from '../type-utils.js';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type Narrowable = string | number | boolean | null | undefined | bigint | symbol | {};

function cloneDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(cloneDeep) as unknown as T;
  }
  if (value && typeof value === 'object') {
    if (value instanceof Date) {
      return new Date(value) as unknown as T;
    }
    if (value instanceof RegExp) {
      return new RegExp(value) as unknown as T;
    }
    if (value instanceof Map) {
      return new Map(Array.from(value.entries()).map(([k, v]) => [cloneDeep(k), cloneDeep(v)])) as unknown as T;
    }
    if (value instanceof Set) {
      return new Set(Array.from(value).map(cloneDeep)) as unknown as T;
    }
    const result: any = Object.create(Object.getPrototypeOf(value));
    for (const key of Object.keys(value)) {
      result[key] = cloneDeep((value as any)[key]);
    }
    return result as T;
  }
  return value;
}

const clonedResult = reactive((result: QueryPromise<Query>) => cloneDeep(result.value));

const riefiedQuery = reactive(
  <T extends Query>(
    QueryClass: new () => T,
    ...args: HasRequiredKeys<ExtractQueryParams<T>> extends true
      ? [params: Optionalize<Signalize<ExtractQueryParams<T>>>]
      : [params?: Optionalize<Signalize<ExtractQueryParams<T>>> | undefined]
  ): QueryPromise<T> => {
    const queryResult = getQuery(QueryClass, ...args);

    return new Proxy(queryResult, {
      get(target, prop, receiver) {
        if (prop === 'value') {
          return clonedResult(target);
        }

        return Reflect.get(target, prop, receiver);
      },
    });
  },
);

const resultValue = reactive((result: QueryPromise<Query>) => result.value);

export function useQuery<T extends Query>(
  QueryClass: new () => T,
  ...args: HasRequiredKeys<ExtractQueryParams<T>> extends true
    ? [params: Optionalize<Signalize<ExtractQueryParams<T>>>]
    : [params?: Optionalize<Signalize<ExtractQueryParams<T>>> | undefined]
): QueryPromise<T> {
  const result = useReactive(riefiedQuery, QueryClass, ...args);

  useReactive(resultValue, result);

  return result;
}
