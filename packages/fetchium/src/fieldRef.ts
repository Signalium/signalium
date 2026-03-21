import type { QueryContext } from './QueryClient.js';

// ================================
// Symbols
// ================================

const FIELD_REF_BRAND = Symbol('fieldRef');
const FIELD_REF_PATH = Symbol('fieldRefPath');

export const DEFINITION_TARGET = Symbol('DEFINITION_TARGET');
export const CANCEL_PROXY = Symbol('CANCEL_PROXY');

// ================================
// FieldRef placeholder regex
// ================================

const FIELD_REF_PLACEHOLDER = /\[([^\]]+)\]/g;

// ================================
// FieldRef (recursive Proxy)
// ================================

function createFieldRef(path: string[]): unknown {
  const target = {
    [FIELD_REF_BRAND]: true,
    [FIELD_REF_PATH]: path,
  };

  return new Proxy(target, fieldRefHandler);
}

const fieldRefHandler: ProxyHandler<Record<symbol, unknown>> = {
  get(target, prop) {
    if (prop === FIELD_REF_BRAND) return true;
    if (prop === FIELD_REF_PATH) return target[FIELD_REF_PATH];

    if (prop === Symbol.toPrimitive || prop === 'toString' || prop === 'valueOf') {
      const path = target[FIELD_REF_PATH] as string[];
      return () => `[${path.join('.')}]`;
    }

    if (typeof prop === 'symbol') return undefined;

    const parentPath = target[FIELD_REF_PATH] as string[];
    return createFieldRef([...parentPath, prop]);
  },

  has(target, prop) {
    return prop === FIELD_REF_BRAND || prop === FIELD_REF_PATH;
  },
};

export function isFieldRef(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as any)[FIELD_REF_BRAND] === true;
}

export function getFieldRefPath(ref: unknown): string[] {
  return (ref as any)[FIELD_REF_PATH];
}

// ================================
// Definition Proxy (wraps `this`)
// ================================

export function createDefinitionProxy<T extends object>(target: T): T {
  let cancelled = false;

  return new Proxy(target, {
    set(target, prop, value) {
      (target as any)[prop] = value;
      return true;
    },

    get(target, prop) {
      if (IS_DEV && cancelled) {
        throw new Error('Definition proxy accessed after extraction. Avoid arrow functions that capture `this`.');
      }

      if (prop === DEFINITION_TARGET) return target;
      if (prop === CANCEL_PROXY)
        return () => {
          cancelled = true;
        };

      if (typeof prop === 'symbol') return (target as any)[prop];

      return createFieldRef([prop]);
    },
  }) as T;
}

// ================================
// Definition Extraction
// ================================

export interface CapturedDefinition<T = Record<string, unknown>> {
  fields: T;
  methods: T;
}

export function extractDefinition<T>(instance: T): CapturedDefinition<T> {
  const raw = (instance as any)[DEFINITION_TARGET];
  (instance as any)[CANCEL_PROXY]();

  const fields: Record<string, unknown> = {};
  for (const key of Object.getOwnPropertyNames(raw)) {
    fields[key] = raw[key];
  }

  const methods: Record<string, (...args: unknown[]) => unknown> = {};
  let proto = Object.getPrototypeOf(raw);

  while (proto && proto !== Object.prototype) {
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key === 'constructor') continue;
      const desc = Object.getOwnPropertyDescriptor(proto, key)!;

      if (typeof desc.value === 'function' && !(key in methods)) {
        methods[key] = desc.value;
      }
    }
    proto = Object.getPrototypeOf(proto);
  }

  return { fields: fields as T, methods: methods as T };
}

// ================================
// Reification (FieldRef → actual values)
// ================================

export function resolveFieldRefPath(path: string[], root: Record<string, unknown>): unknown {
  let current: unknown = root;
  for (const segment of path) {
    if (current === undefined || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function reifyStringPlaceholders(str: string, root: Record<string, unknown>): string {
  return str.replace(FIELD_REF_PLACEHOLDER, (_match, pathStr: string) => {
    const path = pathStr.split('.');
    const value = resolveFieldRefPath(path, root);
    return value !== undefined && value !== null ? encodeURIComponent(String(value)) : '';
  });
}

export function reifyValue(value: unknown, root: Record<string, unknown>): unknown {
  if (isFieldRef(value)) {
    return resolveFieldRefPath(getFieldRefPath(value), root);
  }

  if (typeof value === 'string') {
    return reifyStringPlaceholders(value, root);
  }

  if (Array.isArray(value)) {
    return value.map(v => reifyValue(v, root));
  }

  if (typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      result[key] = reifyValue((value as Record<string, unknown>)[key], root);
    }
    return result;
  }

  return value;
}

// ================================
// Execution Context
// ================================

export function createExecutionContext<T>(
  captured: CapturedDefinition<T>,
  actualParams: Record<string, unknown>,
  queryContext: QueryContext,
): T {
  const fields = captured.fields as Record<string, unknown>;
  const methods = captured.methods as Record<string, (...args: unknown[]) => unknown>;

  const root: Record<string, unknown> = { params: actualParams };
  const ctx: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(fields)) {
    ctx[key] = reifyValue(value, root);
  }

  ctx.params = actualParams;
  ctx.context = queryContext;

  for (const [key, method] of Object.entries(methods)) {
    ctx[key] = method.bind(ctx);
  }

  return ctx as T;
}
