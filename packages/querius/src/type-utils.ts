import { Signal } from 'signalium';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type HasRequiredKeys<T> = {} extends T ? false : { [K in keyof T]: undefined } extends T ? false : true;

// Make all types in an object are `foo: type | undefined` become `foo?: type`
export type Optionalize<T> = T extends object
  ? {
      -readonly [K in keyof T as undefined extends T[K] ? never : K]: T[K];
    } & {
      -readonly [K in keyof T as undefined extends T[K] ? K : never]?: T[K];
    }
  : T;

export type Signalize<T> = {
  [K in keyof T]: T[K] | Signal<T[K]> | Signal<T[K] extends infer U ? U : never>;
};

// Reifies types so that you get a nice object with all the keys and values, rather
// than a nested type definition that's unreadable
export type Prettify<T> = T extends object
  ? {
      -readonly [K in keyof T]: T[K];
    } & {}
  : T;
