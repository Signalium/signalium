import { useReactive } from 'signalium/react';
import { reactive } from 'signalium';
import { ExtractType, QueryPromise } from '../types.js';
import { ExtractQueryParams, fetchQuery, Query } from '../query.js';
import { HasRequiredKeys, Optionalize, Signalize } from '../type-utils.js';

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

const reifiedQuery = reactive(
  <T extends Query>(
    QueryClass: new () => T,
    ...args: HasRequiredKeys<ExtractType<T['params']>> extends true
      ? [params: Optionalize<Signalize<ExtractType<T['params']>>>]
      : [params?: Optionalize<Signalize<ExtractType<T['params']>>> | undefined]
  ): QueryPromise<T> => {
    const queryResult = fetchQuery(QueryClass, ...args);

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
  ...args: HasRequiredKeys<ExtractType<T['params']>> extends true
    ? [params: Optionalize<Signalize<ExtractType<T['params']>>>]
    : [params?: Optionalize<Signalize<ExtractType<T['params']>>> | undefined]
): QueryPromise<T> {
  const result = useReactive(reifiedQuery, QueryClass, ...args);

  useReactive(resultValue, result);

  return result;
}
