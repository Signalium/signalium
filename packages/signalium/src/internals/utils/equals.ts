import { Equals } from '../../types.js';

export const DEFAULT_EQUALS: Equals<unknown> = (a, b) => a === b;
export const FALSE_EQUALS: Equals<unknown> = () => false;

export const equalsFrom = <T>(equals: Equals<T> | false | undefined): Equals<T> => {
  if (equals === false) {
    return FALSE_EQUALS;
  }

  return equals ?? DEFAULT_EQUALS;
};
