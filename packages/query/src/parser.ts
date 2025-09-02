import { context, Signal } from 'signalium';

interface Validations {
  // Number validations
  max: number;
  min: number;
  multipleOf: number;
  exclusiveMax: number;
  exclusiveMin: number;

  // String validations
  maxLength: number;
  minLength: number;
  pattern: RegExp;

  // Object/Record validations
  maxProperties: number;
  minProperties: number;

  // Array validations
  maxItems: number;
  minItems: number;
  uniqueItems: boolean;
  contains: Validator<unknown>;
  maxContains: number;
  minContains: number;
}

// interface ValidatableTypes

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace SignaliumQueryRest {
    /** App-extendable registry of logical types */
    interface CustomFormatters {
      'date-time': Date;
      date: Date;
    }
  }
}

export type ResolveType<Name extends string, BackupType> = Name extends keyof SignaliumQueryRest.CustomFormatters
  ? SignaliumQueryRest.CustomFormatters[Name]
  : BackupType;

interface ValidationConfig {
  getEntityKey: (entity: Record<string, unknown>) => string;
}

interface ValidationContext {
  errors: ValidationError[];
  entityStore: EntityStore;
  formatRegistry: FormatRegistry;
  config: ValidationConfig;
}

interface FormatRegistry {
  get: <Name extends string, Backup>(name: Name, backup: Validator<Backup>) => Validator<ResolveType<Name, Backup>>;
}

interface Entity<T extends Record<string, unknown>> {
  proxy: T;
  signal: Signal<T>;
  validator: Validator<T>;
}

interface EntityStore {
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
}

// interface IValidator<T> {
//   nullable: Validator<T | null>;
//   optional: Validator<T | undefined>;
//   nullish: Validator<T | null | undefined>;
//   format: <Name extends string>(formatName: Name) => Validator<ResolveType<Name, T>>;
//   validations: (validations: Validations) => Validator<T>;
// }

type Parse<T> = (value: unknown, context: ValidationContext) => T;
type Serialize<T> = (value: T, context: ValidationContext) => unknown;

class Validator<T> {
  parse: Parse<T>;
  serialize: Serialize<T> | undefined;

  constructor(parse: Parse<T>, serialize?: Serialize<T>) {
    this.parse = parse;
    this.serialize = serialize;
  }

  _nullable: Validator<T | null> | undefined = undefined;
  _optional: Validator<T | undefined> | undefined = undefined;
  _nullish: Validator<T | null | undefined> | undefined = undefined;

  get nullable(): Validator<T | null> {
    let v = this._nullable;
    if (!v) {
      const { parse: originalParse, serialize: originalSerialize } = this;
      const parse: Parse<T | null> = (value, context) => (value === null ? null : originalParse(value, context));
      const serialize: Serialize<T | null> | undefined = originalSerialize
        ? (value, context) => (value === null ? null : originalSerialize?.(value, context))
        : undefined;

      v = this._nullable = new Validator<T | null>(parse, serialize);
    }
    return v;
  }

  get optional(): Validator<T | undefined> {
    let v = this._optional;
    if (!v) {
      const { parse: originalParse, serialize: originalSerialize } = this;
      const parse: Parse<T | undefined> = (value, context) =>
        value === undefined ? undefined : originalParse(value, context);
      const serialize: Serialize<T | undefined> | undefined = originalSerialize
        ? (value, context) => (value === undefined ? undefined : originalSerialize?.(value, context))
        : undefined;

      v = this._optional = new Validator<T | undefined>(parse, serialize);
    }
    return v;
  }

  get nullish(): Validator<T | null | undefined> {
    let v = this._nullish;
    if (!v) {
      const { parse: originalParse, serialize: originalSerialize } = this;
      const parse: Parse<T | null | undefined> = (value, context) =>
        value === null ? null : value === undefined ? value : originalParse(value, context);
      const serialize: Serialize<T | null | undefined> | undefined = originalSerialize
        ? (value, context) => (value === null || value === undefined ? value : originalSerialize?.(value, context))
        : undefined;

      v = this._nullish = new Validator<T | null | undefined>(parse, serialize);
    }
    return v;
  }

  format<Name extends string>(formatName: Name): Validator<ResolveType<Name, T>> {
    return formatRegistry.get(formatName, this);
  }
}

function object<T extends Record<string, unknown>>(validator: { [K in keyof T]: Validator<T[K]> }) {
  const validators: [keyof T, Validator<T[keyof T]>][] = Object.entries(validator);
  const parsers: [keyof T, Parse<T[keyof T]>][] = [];

  const serializers: [keyof T, Serialize<T[keyof T]>][] = [];

  for (const [key, v] of validators) {
    const { parse, serialize } = v;

    parsers.push([key, parse]);

    if (serialize) {
      serializers.push([key, serialize]);
    }
  }

  const parse: Parse<T> = (_value, context) => {
    if (typeof _value !== 'object' || _value === null) {
      context.errors.push({ path: '', message: 'Invalid object' });
      // return null;
      throw new Error('Invalid object');
    }

    const value = _value as Record<keyof T, unknown>;

    for (const [key, parser] of parsers) {
      value[key] = parser(value[key], context);
    }

    return value as T;
  };

  const serialize: Serialize<T> | undefined =
    serializers.length > 0
      ? (value, context) => {
          const clonedValue = { ...value } as Record<keyof T, unknown>;

          for (const [key, serializer] of serializers) {
            clonedValue[key] = serializer(value[key], context);
          }
        }
      : undefined;

  return new Validator<T>(parse, serialize);
}

function array<T>(validator: Validator<T>) {
  const { parse: parseItem, serialize: serializeItem } = validator;

  const parseArray: Parse<T[]> = (value, context) => {
    if (!Array.isArray(value)) {
      context.errors.push({ path: '', message: 'Invalid array' });
      throw new Error('Invalid array');
    }

    return value.map(v => parseItem(v, context));
  };

  const serializeArray: Serialize<T[]> | undefined = serializeItem
    ? (value, context) => value.map(v => serializeItem?.(v, context))
    : undefined;

  return new Validator<T[]>(parseArray, serializeArray);
}

function tuple<T extends readonly Validator<unknown>[]>(validators: T) {
  const parsers = validators.map(v => v.parse);
  const serializers = validators.map(v => v.serialize);

  return new Validator<[...ValidatorOutputs<T>]>(
    (value, context) => {
      if (!Array.isArray(value)) {
        context.errors.push({ path: '', message: 'Invalid tuple' });
        throw new Error('Invalid tuple');
      } else if (value.length !== validators.length) {
        context.errors.push({ path: '', message: 'Invalid tuple length' });
        throw new Error('Invalid tuple length');
      }

      for (let i = 0; i < validators.length; i++) {
        value[i] = parsers[i](value[i], context);
      }

      return value as [...ValidatorOutputs<T>];
    },
    (value, context) => value.map((v, index) => serializers[index](v, context)),
  );
}

function record<V>(validator: Validator<V>) {
  const parse = validator.parse;
  const serialize = validator.serialize;

  return new Validator<Record<string, V>>(
    (value, context) => {
      if (typeof value !== 'object' || value === null) {
        context.errors.push({ path: '', message: 'Invalid record' });
        throw new Error('Invalid record');
      }

      return Object.entries(value).map(([key, v]) => [key, parse(v, context)]);
    },
    (value, context) => {},
  );
}

const string = new Validator<string>((value, context) => {
  if (typeof value !== 'string') {
    context.errors.push({ path: '', message: 'Invalid string' });
    throw new Error('Invalid string');
  }
  return value;
});

const number = new Validator<number>((value, context) => {
  if (typeof value !== 'number') {
    context.errors.push({ path: '', message: 'Invalid number' });
    throw new Error('Invalid number');
  }
  return value;
});

const boolean = new Validator<boolean>((value, context) => {
  if (typeof value !== 'boolean') {
    context.errors.push({ path: '', message: 'Invalid boolean' });
    throw new Error('Invalid boolean');
  }
  return value;
});

const _null = new Validator<null>((value, context) => {
  if (value !== null) {
    context.errors.push({ path: '', message: 'Invalid null' });
    throw new Error('Invalid null');
  }
  return value;
});

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace SignaliumQueryRest {
    interface CustomFormatters {
      integer: number;
    }
  }
}

type ValidatorOutput<V> = V extends Validator<infer T> ? T : never;

type UnionOfValidators<VS extends readonly Validator<unknown>[]> = Validator<ValidatorOutput<VS[number]>>;

type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (x: infer I) => void ? I : never;

type IntersectionOfValidators<VS extends readonly Validator<unknown>[]> = Validator<
  UnionToIntersection<ValidatorOutput<VS[number]>>
>;

type ValidatorOutputs<VS extends readonly Validator<unknown>[]> = {
  [I in keyof VS]: VS[I] extends Validator<unknown> ? ValidatorOutput<VS[I]> : never;
};

type CommonKeys<VS extends readonly Validator<unknown>[]> = keyof UnionToIntersection<ValidatorOutputs<VS>[number]>;

type JsonPrimitive = string | number | boolean | null;

interface APITypes {
  const: <T extends JsonPrimitive>(value: T) => Validator<T>;
  string: Validator<string>;
  number: Validator<number>;
  integer: Validator<number>;
  boolean: Validator<boolean>;
  null: Validator<null>;

  array: (<T>(validator: Validator<T>) => Validator<T[]>) & {
    prefixed: <const VS extends readonly Validator<unknown>[], R>(
      prefixValidators: VS,
      validator: Validator<R>,
    ) => Validator<[...ValidatorOutputs<VS>, ...R[]]>;
  };
  tuple: <const VS extends readonly Validator<unknown>[]>(validators: VS) => Validator<[...ValidatorOutputs<VS>]>;

  object: <T extends Record<string, unknown>>(validator: { [K in keyof T]: Validator<T[K]> }) => Validator<T>;
  record: <V>(validator: Validator<V>) => Validator<Record<string, V>>;

  oneOf: (<VS extends readonly Validator<unknown>[]>(validators: VS) => UnionOfValidators<VS>) & {
    discriminated: <const VS extends readonly Validator<object>[], const K extends CommonKeys<VS> & string>(
      key: K,
      validators: VS,
    ) => Validator<ValidatorOutputs<VS>[number]>;
  };
  anyOf: (<VS extends readonly Validator<unknown>[]>(validators: VS) => UnionOfValidators<VS>) & {
    discriminated: <const VS extends readonly Validator<object>[], const K extends CommonKeys<VS> & string>(
      key: K,
      validators: VS,
    ) => Validator<ValidatorOutputs<VS>[number]>;
  };
  allOf: <VS extends readonly Validator<unknown>[]>(validators: VS) => IntersectionOfValidators<VS>;
}

type ExtractValidatorsFromRecord<T extends Record<string, Validator<unknown>>> = {
  [K in keyof T as undefined extends ValidatorOutput<T[K]> ? never : K]: ValidatorOutput<T[K]>;
} & {
  [K in keyof T as undefined extends ValidatorOutput<T[K]> ? K : never]?: Exclude<ValidatorOutput<T[K]>, undefined>;
};

type ExtractValidators<T extends Validator<unknown> | Record<string, Validator<unknown>> | undefined> =
  T extends Validator<infer U>
    ? U
    : T extends Record<string, Validator<unknown>>
      ? ExtractValidatorsFromRecord<T>
      : Record<never, never>;

type PathParamNames<S extends string> = S extends `${string}{${infer P}}`
  ? P extends `${infer Name}/${infer Rest}`
    ? Name | PathParamNames<Rest>
    : P
  : never;

type UrlParamsFromPath<S extends string> =
  PathParamNames<S> extends never ? Record<never, never> : { [K in PathParamNames<S>]: string | number };

declare const t: APITypes;

declare function schema<T>(validatorBuilder: (t: APITypes) => Validator<T>): Validator<T>;
declare function entity<T extends Record<string, unknown>>(
  validatorBuilder: (t: APITypes) => { [K in keyof T]: Validator<T[K]> },
): Validator<T>;

interface QueryDefinition {
  readonly path: string;
  readonly searchParams?: Record<string, Validator<unknown>>;
  readonly response: Validator<unknown> | Record<string, Validator<unknown>>;
}

type QueryParams<QDef extends QueryDefinition> = UrlParamsFromPath<QDef['path']> &
  ExtractValidators<QDef['searchParams']>;

type RequiredKeys<T> = keyof T extends never
  ? never
  : { [K in keyof T]-?: T extends Record<K, T[K]> ? K : never }[keyof T];
type HasRequiredKeys<T> = [RequiredKeys<T>] extends [never] ? false : true;

declare function query<const QDef extends QueryDefinition>(
  queryDefinitionBuilder: (t: APITypes) => QDef,
): (
  ...args: HasRequiredKeys<QueryParams<QDef>> extends true ? [params: QueryParams<QDef>] : [params?: QueryParams<QDef>]
) => Promise<ExtractValidators<QDef['response']>>;

declare function mutation<
  const Def extends {
    method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    path: string;
    url: string;
    searchParams?: Record<string, Validator<unknown>>;
    body: Validator<unknown>;
    response: Validator<unknown> | Record<string, Validator<unknown>>;
  },
>(
  options: Def,
): (
  params: UrlParamsFromPath<Def['path']> & ExtractValidators<Def['searchParams']>,
  body: ExtractValidators<Def['body']>,
) => Promise<ExtractValidators<Def['response']>>;

const Items = schema(t => t.array(Item));

export type Item = ValidatorOutput<typeof Item>;
export const Item = schema(t => t.anyOf.discriminated('type', [TextItem, ImageItem, VideoItem]));

export type TextItem = ValidatorOutput<typeof TextItem>;
export const TextItem = entity(t => ({
  type: t.const('text'),
  text: t.string,
}));

const ImageItem = entity(t => ({
  type: t.const('image'),
  url: t.string,
  alt: t.string,
}));

const VideoItem = entity(t => ({
  type: t.const('video'),
  url: t.string,
  durationSec: t.number,
  thumbnail: t.oneOf([t.string, t.object({ url: t.string, alt: t.string })]),
}));

const listItems = query(t => ({
  path: '/items',
  response: Items,
  searchParams: {
    page: t.number.optional,
  },
}));

const listItemsResult = listItems();

const getItem = query(t => ({
  path: '/items/{id}',
  response: t.array(Item),
  searchParams: {
    page: t.number.optional,
  },
}));

const result = getItem({ id: '1', page: 1 });

const createItem = mutation({
  method: 'POST',
  path: '/items',
  url: '/items',
  body: Item,
  response: Item,
});

interface ValidationError {
  path: string;
  message: string;
}

const result = parse(Item, { type: 'text', text: 'Hello' });
