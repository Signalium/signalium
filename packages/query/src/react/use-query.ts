import { useReactive } from 'signalium/react';
import { reactive } from 'signalium';
import { QueryResult, InfiniteQueryResult, StreamQueryResult } from '../types.js';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type Narrowable = string | number | boolean | null | undefined | bigint | symbol | {};

function cloneDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(cloneDeep) as unknown as T;
  }
  if (value && typeof value === 'object') {
    // Handle Date
    if (value instanceof Date) {
      return new Date(value) as unknown as T;
    }
    // Handle RegExp
    if (value instanceof RegExp) {
      return new RegExp(value) as unknown as T;
    }
    // Handle Map
    if (value instanceof Map) {
      return new Map(Array.from(value.entries()).map(([k, v]) => [cloneDeep(k), cloneDeep(v)])) as unknown as T;
    }
    // Handle Set
    if (value instanceof Set) {
      return new Set(Array.from(value).map(cloneDeep)) as unknown as T;
    }
    // Handle plain objects
    const result: any = Object.create(Object.getPrototypeOf(value));
    for (const key of Object.keys(value)) {
      result[key] = cloneDeep((value as any)[key]);
    }
    return result as T;
  }
  return value;
}

const clonedResult = reactive(
  (result: QueryResult<unknown> | InfiniteQueryResult<unknown> | StreamQueryResult<unknown>) => cloneDeep(result.value),
);

const riefiedQuery = reactive(
  <R, Args extends readonly Narrowable[]>(
    fn: (...args: Args) => QueryResult<R> | InfiniteQueryResult<R> | StreamQueryResult<R>,
    ...args: Args
  ): QueryResult<R> | InfiniteQueryResult<R> | StreamQueryResult<R> => {
    const queryResult = fn(...args);

    return new Proxy(queryResult, {
      get(target, prop, receiver) {
        // Clone the value property when accessed
        if (prop === 'value') {
          return clonedResult(target);
        }

        // Forward all other properties/methods to the original query result
        return Reflect.get(target, prop, receiver);
      },
    });
  },
);

// Overload for standard query
export function useQuery<R, Args extends readonly Narrowable[]>(
  fn: (...args: Args) => QueryResult<R>,
  ...args: Args
): QueryResult<R>;

// Overload for infinite query
export function useQuery<R, Args extends readonly Narrowable[]>(
  fn: (...args: Args) => InfiniteQueryResult<R>,
  ...args: Args
): InfiniteQueryResult<R>;

// Overload for stream query
export function useQuery<R, Args extends readonly Narrowable[]>(
  fn: (...args: Args) => StreamQueryResult<R>,
  ...args: Args
): StreamQueryResult<R>;

// Implementation
export function useQuery<R, Args extends readonly Narrowable[]>(
  fn: (...args: Args) => QueryResult<R> | InfiniteQueryResult<R> | StreamQueryResult<R>,
  ...args: Args
): QueryResult<R> | InfiniteQueryResult<R> | StreamQueryResult<R> {
  const result = useReactive(riefiedQuery, fn, ...args) as
    | QueryResult<R>
    | InfiniteQueryResult<R>
    | StreamQueryResult<R>;

  useReactive(() => result.value);

  return result;
}
