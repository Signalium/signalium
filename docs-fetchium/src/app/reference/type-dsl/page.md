---
title: Type DSL Deep Dive
---

The `t` DSL defines the shape of your data --- params, results, and entity fields. Fetchium uses these shapes for three purposes: **validating and parsing** API responses, **extracting and normalizing** entities into the cache, and **inferring TypeScript types** so your queries are fully typed end-to-end.

The [Queries](/core/queries) page covers the basics. This reference is the exhaustive guide to every type definition, including edge cases, composition rules, and advanced features.

---

## Primitives

Primitives are the building blocks. Each one matches a single JavaScript type.

| Definition    | TypeScript type | Matches                  |
| ------------- | --------------- | ------------------------ |
| `t.string`    | `string`        | Any string value         |
| `t.number`    | `number`        | Any numeric value        |
| `t.boolean`   | `boolean`       | `true` or `false`        |
| `t.null`      | `null`          | The literal value `null` |
| `t.undefined` | `undefined`     | The value `undefined`    |

Primitives are the most common type definitions and are used directly as field values on entities or inside collections:

```tsx
class ServerHealth extends Entity {
  __typename = t.typename('ServerHealth');
  id = t.id;
  status = t.string;
  uptime = t.number;
  healthy = t.boolean;
}
```

During parsing, Fetchium validates that the incoming value matches the expected primitive type. A `t.number` field receiving a string from the API will produce a parse error (or fall back to `undefined` if wrapped in `t.optional`).

---

## Identity: `t.id`

| Definition | TypeScript type    | Description                                       |
| ---------- | ------------------ | ------------------------------------------------- |
| `t.id`     | `string \| number` | Marks the identity field for entity normalization |

Every Entity class must have exactly one `t.id` field. This field, combined with `t.typename(...)`, forms the unique key that Fetchium uses to deduplicate and normalize entities in the cache.

```tsx
class User extends Entity {
  __typename = t.typename('User');
  id = t.id; // Required: the identity field
  name = t.string;
}
```

The `t.id` type accepts both strings and numbers, so your API can use either format for identifiers. Fetchium treats `id: 1` and `id: '1'` as distinct identities.

{% callout title="One id per entity" type="warning" %}
Defining more than one `t.id` field on a single entity class will throw an error at definition time. If your entity has a composite key, consider combining the parts into a single string field.
{% /callout %}

---

## Collections

### `t.array(type)`

Creates a typed array. The argument is the element type --- it can be any type definition, including entities, objects, unions, or other collections.

```tsx
// Array of primitives
result = t.array(t.string); // string[]

// Array of entities
result = t.array(t.entity(User)); // User[]

// Array of objects
result = t.array(
  t.object({
    // { name: string, score: number }[]
    name: t.string,
    score: t.number,
  }),
);

// Nested arrays
result = t.array(t.array(t.number)); // number[][]
```

During parsing, each element in the array is validated individually. If an element fails validation, the behavior depends on whether it is wrapped in `t.result` (see [Parse Results](#parse-results) below) or `t.optional`.

### `t.object({ key: type, ... })`

Defines a plain object with known keys. Each key maps to a type definition.

```tsx
result = t.object({
  total: t.number,
  page: t.number,
  users: t.array(t.entity(User)),
});
```

Object types can be nested:

```tsx
result = t.object({
  meta: t.object({
    requestId: t.string,
    timestamp: t.format('date-time'),
  }),
  data: t.array(t.entity(Post)),
});
```

{% callout title="Objects vs Entities" type="note" %}
`t.object(...)` defines a **plain object** --- it is not normalized or cached. Use Entity classes when you need identity, deduplication, and reactive property tracking. Use `t.object(...)` for anonymous shapes like pagination metadata or API envelopes.
{% /callout %}

### `t.record(type)`

Defines a string-keyed dictionary where every value has the same type.

```tsx
// Record of numbers
result = t.record(t.number); // Record<string, number>

// Record of entities
result = t.record(t.entity(User)); // Record<string, User>

// Useful for key-value maps from the API
result = t.object({
  usersById: t.record(t.entity(User)),
  featureFlags: t.record(t.boolean),
});
```

Unlike `t.object(...)`, the keys of a record are not known at definition time. Fetchium validates each value in the record against the given type.

---

## Entity References

### `t.entity(EntityClass)`

References a normalized entity. This tells Fetchium to extract the nested object, store it in the entity cache by its `(typename, id)` key, and return an identity-stable proxy.

```tsx
class Comment extends Entity {
  __typename = t.typename('Comment');
  id = t.id;
  body = t.string;
  author = t.entity(User); // Normalized reference to User
}
```

When the API response contains `{ author: { __typename: 'User', id: '1', name: 'Alice' } }`, Fetchium extracts and normalizes the nested `User`. The `author` field on the `Comment` proxy points to the same `User` proxy as every other reference to User #1.

### Circular references

Entity classes can reference each other. Because each entity class is resolved lazily when first needed, circular references work naturally:

```tsx
class User extends Entity {
  __typename = t.typename('User');
  id = t.id;
  name = t.string;
  posts = t.array(t.entity(Post)); // User -> Post
}

class Post extends Entity {
  __typename = t.typename('Post');
  id = t.id;
  title = t.string;
  author = t.entity(User); // Post -> User
}
```

Fetchium resolves entity definitions lazily (the first time a query using that entity is fetched), so the order of class declaration does not matter. Both `User` and `Post` can be defined in the same file or in separate files.

---

## Optionality & Nullability

These wrappers adjust how Fetchium handles missing or null values in API responses.

| Definition         | TypeScript type          | Parsing behavior                                  |
| ------------------ | ------------------------ | ------------------------------------------------- |
| `t.optional(type)` | `T \| undefined`         | Absent or invalid values become `undefined`       |
| `t.nullable(type)` | `T \| null`              | Explicit `null` is accepted; invalid values throw |
| `t.nullish(type)`  | `T \| undefined \| null` | Accepts `null`, `undefined`, or the inner type    |

```tsx
class User extends Entity {
  __typename = t.typename('User');
  id = t.id;
  name = t.string;
  bio = t.optional(t.string); // string | undefined
  avatarUrl = t.nullable(t.string); // string | null
  nickname = t.nullish(t.string); // string | null | undefined
}
```

### Parsing behavior in detail

- **`t.optional(type)`** --- If the field is missing from the API response, or if the value does not match the inner type, the result is `undefined`. This is the safest wrapper for fields that may or may not be present.
- **`t.nullable(type)`** --- Accepts `null` as a valid value. If the value is non-null but does not match the inner type, a parse error is raised.
- **`t.nullish(type)`** --- Combines both: `null` and `undefined` are accepted, and missing fields default to `undefined`.

### Combining with other types

Optionality wrappers can wrap any type definition, including complex types:

```tsx
// Optional array
tags = t.optional(t.array(t.string)); // string[] | undefined

// Nullable entity reference
manager = t.nullable(t.entity(User)); // User | null

// Nullish nested object
metadata = t.nullish(
  t.object({
    // { key: string } | null | undefined
    key: t.string,
  }),
);

// Optional formatted value
deletedAt = t.optional(t.format('date-time')); // Date | undefined
```

{% callout title="Optional vs nullable semantics" type="note" %}
Use `t.optional` when the field may be absent from the JSON response entirely (the key is not present). Use `t.nullable` when the API explicitly sends `null` to indicate "no value." Use `t.nullish` when the API may do either.
{% /callout %}

---

## Constants & Enums

### `t.const(value)`

Matches an exact literal value. The value must be a string, number, or boolean.

```tsx
class Config extends Entity {
  __typename = t.typename('Config');
  id = t.id;
  version = t.const(2); // always the number 2
  enabled = t.const(true); // always true
  type = t.const('system'); // always the string 'system'
}
```

During parsing, if the incoming value does not strictly equal the constant, a parse error is raised.

### `t.enum(value1, value2, ...)`

Matches one of several literal values. Accepts any mix of strings, numbers, and booleans.

```tsx
class Post extends Entity {
  __typename = t.typename('Post');
  id = t.id;
  status = t.enum('draft', 'published', 'archived');
  priority = t.enum(1, 2, 3);
}
```

The TypeScript type is inferred as a union of the literal types: `'draft' | 'published' | 'archived'` or `1 | 2 | 3`.

### `t.enum.caseInsensitive(value1, value2, ...)`

Case-insensitive string matching for enums. When the API returns `'ACTIVE'` or `'Active'`, it matches `'active'` and is normalized to the canonical casing you defined.

```tsx
class User extends Entity {
  __typename = t.typename('User');
  id = t.id;
  role = t.enum.caseInsensitive('admin', 'editor', 'viewer');
}
```

If the API returns `{ role: 'ADMIN' }`, the parsed value will be `'admin'` (the canonical form). This is useful when your API returns inconsistent casing.

{% callout title="Ambiguous casing" type="warning" %}
`t.enum.caseInsensitive` will throw at definition time if two values have the same lowercase form, e.g. `t.enum.caseInsensitive('Active', 'active')`. Each canonical form must be unique.
{% /callout %}

Non-string values in a case-insensitive enum (numbers, booleans) are always matched exactly.

---

## Unions

### `t.union(type1, type2, ...)`

Defines a value that matches any of the given types.

```tsx
// Union of primitives
field = t.union(t.string, t.number); // string | number

// Union of primitives and null
field = t.union(t.string, t.null); // string | null
```

### Discriminated unions with entities

The most common use of `t.union` is for polymorphic entity types. Each branch must have a `t.typename(...)` field so Fetchium can determine which variant to parse:

```tsx
class TextBlock extends Entity {
  __typename = t.typename('TextBlock');
  id = t.id;
  content = t.string;
}

class ImageBlock extends Entity {
  __typename = t.typename('ImageBlock');
  id = t.id;
  url = t.string;
  alt = t.optional(t.string);
}

class VideoBlock extends Entity {
  __typename = t.typename('VideoBlock');
  id = t.id;
  embedUrl = t.string;
  duration = t.number;
}

// Use in a query or entity field
blocks = t.array(
  t.union(t.entity(TextBlock), t.entity(ImageBlock), t.entity(VideoBlock)),
);
```

When parsing, Fetchium reads the `__typename` field on the incoming object to decide which entity definition to use. If the typename does not match any branch, a parse error is raised.

### Discriminated unions with plain objects

Plain objects can also participate in unions, as long as they have a typename discriminator:

```tsx
const SuccessResponse = t.object({
  type: t.typename('success'),
  data: t.array(t.entity(User)),
});

const ErrorResponse = t.object({
  type: t.typename('error'),
  message: t.string,
  code: t.number,
});

result = t.union(SuccessResponse, ErrorResponse);
```

### Unions with arrays and records

A union can include array and record types alongside objects:

```tsx
// Value is either a single entity or an array of entities
field = t.union(t.entity(User), t.array(t.entity(User)));
```

{% callout title="Union constraints" type="note" %}
When a union contains multiple object/entity types, each must have a `t.typename(...)` field to serve as the discriminator. All branches must use the same typename field name (e.g. all use `__typename` or all use `type`). A union can contain at most one array type and at most one record type.
{% /callout %}

### Mixing primitives with complex types

You can combine primitives and complex types in a single union:

```tsx
// Value is either a number or an object with details
field = t.union(
  t.number,
  t.object({
    type: t.typename('detailed'),
    value: t.number,
    label: t.string,
  }),
);
```

Fetchium checks the runtime type of the incoming value: if it is a number, the primitive branch matches. If it is an object, the typename discriminator is checked.

---

## Formatted Values

Formatted values transform raw API values (strings or numbers) into richer JavaScript types during parsing, and serialize them back to the original format for caching and persistence.

### Built-in formats

| Format        | Raw type | Parsed type | Description                                       |
| ------------- | -------- | ----------- | ------------------------------------------------- |
| `'date'`      | `string` | `Date`      | ISO date string (`YYYY-MM-DD`) parsed as UTC Date |
| `'date-time'` | `string` | `Date`      | ISO 8601 datetime string parsed to Date           |

```tsx
class Event extends Entity {
  __typename = t.typename('Event');
  id = t.id;
  name = t.string;
  startDate = t.format('date'); // "2024-03-15" -> Date
  createdAt = t.format('date-time'); // "2024-03-15T10:30:00Z" -> Date
}
```

The `'date'` format expects `YYYY-MM-DD` and parses it as a UTC date to avoid timezone issues. The `'date-time'` format accepts any valid ISO 8601 string and delegates to `new Date(value)`. Both throw a parse error if the input string is not a valid date.

### Custom formats with `registerFormat()`

You can register your own formats with `registerFormat` from `fetchium`. A format has a name, a base type (`Mask.STRING` or `Mask.NUMBER`), a parse function, and a serialize function.

```tsx
import { registerFormat } from 'fetchium';
import { Mask } from 'fetchium';

// Register a 'currency' format that parses "$1,234.56" to a number
registerFormat(
  'currency', // format name
  Mask.STRING, // raw type from API
  (raw) => parseFloat(raw.replace(/[$,]/g, '')), // parse: string -> number
  (value) => `$${value.toFixed(2)}`, // serialize: number -> string
);
```

After registration, use the format in your type definitions:

```tsx
class Product extends Entity {
  __typename = t.typename('Product');
  id = t.id;
  name = t.string;
  price = t.format('currency');
}
```

To get full TypeScript type inference for custom formats, extend the global `FormatRegistry` via module augmentation:

```tsx
declare global {
  namespace SignaliumQuery {
    interface FormatRegistry {
      currency: number;
    }
  }
}
```

### Eager vs lazy evaluation

By default, formats are **eagerly** evaluated --- the parse function runs immediately when the entity data is first stored. You can opt into lazy evaluation by passing `{ eager: false }`:

```tsx
registerFormat(
  'expensive-parse',
  Mask.STRING,
  (raw) => expensiveComputation(raw),
  (value) => serializeBack(value),
  { eager: false }, // Parse on first access, not on store
);
```

With lazy evaluation, the raw value is stored internally and the parse function is called the first time the field is read. This is useful for expensive transformations that may not always be needed. The result is cached after the first parse.

### Serialization

When entities are persisted to a cache store (e.g. IndexedDB), formatted values are serialized back to their raw form using the serialize function. This ensures that cache entries are always stored in the original API format and can be re-parsed correctly on load.

---

## Parse Results

### `t.result(type)`

Wraps a type definition so that parsing returns a `ParseResult<T>` instead of throwing on failure. This is useful for fields where you want to handle parse errors gracefully rather than failing the entire response.

```tsx
class GetItems extends RESTQuery {
  path = '/items';
  result = {
    items: t.array(t.result(t.number)),
  };
}
```

A `ParseResult<T>` is a discriminated union:

```tsx
type ParseResult<T> =
  | { success: true; value: T }
  | { success: false; error: Error };
```

### Usage patterns

**Individual field validation:**

```tsx
result = t.object({
  name: t.string, // Must be a valid string
  maybeNumber: t.result(t.number), // Returns ParseResult<number>
});

// After fetching:
if (result.maybeNumber.success) {
  console.log(result.maybeNumber.value); // number
} else {
  console.log(result.maybeNumber.error); // Error
}
```

**Per-element validation in arrays:**

```tsx
result = {
  items: t.array(t.result(t.entity(User))),
};

// Each element is independently validated:
// [{ success: true, value: User }, { success: false, error: Error }, ...]
```

**With enums:**

```tsx
const Status = t.enum('active', 'inactive', 'pending');

result = {
  status: t.result(Status),
};

// Returns { success: true, value: 'active' } or { success: false, error: Error }
```

**With formatted types:**

```tsx
result = {
  date: t.result(t.format('date-time')),
};

// Invalid date strings produce { success: false, error: Error }
// Valid strings produce { success: true, value: Date }
```

### Interaction with `t.optional`

When `t.result` wraps `t.optional(type)`, invalid values fall back to `undefined` instead of producing an error:

```tsx
result = {
  value: t.result(t.optional(t.number)),
};

// Input: "not a number"
// Result: { success: true, value: undefined }
// (falls back to undefined because t.optional allows it)
```

This gives you a way to silently discard bad values while still using the `ParseResult` wrapper for structured handling.

---

## Typename Discriminator

### `t.typename(value)`

Declares the typename discriminator field on an entity or object. This is not a regular data field --- it tells Fetchium how to identify the entity type for normalization and union discrimination.

```tsx
class User extends Entity {
  __typename = t.typename('User');
  id = t.id;
  name = t.string;
}
```

The typename value must match the `__typename` (or equivalent) field in API responses. When parsing a union, Fetchium reads this field to determine which branch to use.

{% callout title="Required for entities" type="warning" %}
Every Entity class must have a typename field. Without it, Fetchium cannot route entities into the normalized cache, and deduplication will not work.
{% /callout %}

---

## TypeScript Inference

### `ExtractType<TypeDef>`

Fetchium provides full type inference through the `ExtractType` utility type. You rarely need to use it directly --- the return types of `useQuery` and `fetchQuery` are already fully typed. But it is available for advanced use cases.

```tsx
import { ExtractType, t } from 'fetchium';

const UserShape = t.object({
  name: t.string,
  age: t.number,
  email: t.optional(t.string),
});

// Extracts: { name: string; age: number; email: string | undefined }
type UserType = ExtractType<typeof UserShape>;
```

Type inference works through all type combinators:

```tsx
// Through arrays
type Users = ExtractType<typeof t.array(t.entity(User))>;  // User[]

// Through records
type UserMap = ExtractType<typeof t.record(t.entity(User))>; // Record<string, User>

// Through unions
type Block = ExtractType<typeof t.union(
  t.entity(TextBlock),
  t.entity(ImageBlock),
)>;  // TextBlock | ImageBlock

// Through optionality
type MaybeUser = ExtractType<typeof t.nullable(t.entity(User))>; // User | null
```

Query results are automatically typed via `ExtractType` applied to the `result` field:

```tsx
class GetUser extends RESTQuery {
  params = { id: t.number };
  path = '/users/[id]';
  result = User; // Entity class
}

// useQuery(GetUser, { id: 1 }) returns QueryPromise
// where .value is typed as User (the entity proxy type)
```

---

## Live Collection Types

These types create reactive collections that automatically update when entities change. They are covered in detail in the [Live Data](/core/live-data) guide; here is a brief reference.

### `t.liveArray(Entity, opts?)`

A reactive array of entities that automatically adds new entities and removes deleted ones.

```tsx
class List extends Entity {
  __typename = t.typename('List');
  id = t.id;
  items = t.liveArray(Item, {
    constraints: { listId: this.id },
    sort: (a, b) => a.name.localeCompare(b.name),
  });
}
```

Accepts a single Entity class or an array of Entity classes. Options include `constraints` (filter which entities are included) and `sort` (maintain sort order).

### `t.liveValue(valueType, Entity, opts)`

A reactive scalar value that updates via reducer callbacks when matching entities change.

```tsx
class List extends Entity {
  __typename = t.typename('List');
  id = t.id;
  itemCount = t.liveValue(t.number, Item, {
    constraints: { listId: this.id },
    onCreate: (count) => count + 1,
    onUpdate: (count) => count,
    onDelete: (count) => count - 1,
  });
}
```

The three callbacks (`onCreate`, `onUpdate`, `onDelete`) receive the current accumulated value and the entity involved, and return the new value.

See [Live Data](/core/live-data) for full documentation on constraints, sorting, and how live data integrates with mutations and streaming.

---

## Quick Reference

| Definition                          | TypeScript type          | Category        |
| ----------------------------------- | ------------------------ | --------------- |
| `t.string`                          | `string`                 | Primitive       |
| `t.number`                          | `number`                 | Primitive       |
| `t.boolean`                         | `boolean`                | Primitive       |
| `t.null`                            | `null`                   | Primitive       |
| `t.undefined`                       | `undefined`              | Primitive       |
| `t.id`                              | `string \| number`       | Identity        |
| `t.typename(value)`                 | Literal string           | Identity        |
| `t.array(type)`                     | `T[]`                    | Collection      |
| `t.object({ ... })`                 | `{ ... }`                | Collection      |
| `t.record(type)`                    | `Record<string, T>`      | Collection      |
| `t.entity(Class)`                   | Entity proxy             | Entity          |
| `t.optional(type)`                  | `T \| undefined`         | Modifier        |
| `t.nullable(type)`                  | `T \| null`              | Modifier        |
| `t.nullish(type)`                   | `T \| undefined \| null` | Modifier        |
| `t.const(value)`                    | Literal type             | Constant        |
| `t.enum(...values)`                 | Union of literals        | Constant        |
| `t.enum.caseInsensitive(...values)` | Union of literals        | Constant        |
| `t.union(...types)`                 | Union of types           | Combinator      |
| `t.format(name)`                    | Registered format type   | Format          |
| `t.result(type)`                    | `ParseResult<T>`         | Error handling  |
| `t.liveArray(Entity, opts?)`        | `Entity[]` (reactive)    | Live collection |
| `t.liveValue(type, Entity, opts)`   | `T` (reactive)           | Live collection |
