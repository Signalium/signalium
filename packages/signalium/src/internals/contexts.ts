import { ReactiveFnSignal, ReactiveFnDefinition, createReactiveFnSignal } from './reactive.js';
import { hashReactiveFn, hashValue } from './utils/hash.js';
import { scheduleGcSweep } from './scheduling.js';
import { CURRENT_CONSUMER } from './consumer.js';

// ======= Contexts =======

export type Context<T> = {
  defaultValue: T;
};

export type ContextPair<T extends unknown[]> = {
  [K in keyof T]: [Context<T[K]>, NoInfer<T[K]>];
};

let CONTEXT_ID = 0;

export class ContextImpl<T> {
  _key: symbol;
  _description: string;

  constructor(
    public readonly defaultValue: T,
    desc?: string,
  ) {
    this._description = desc ?? `context:${CONTEXT_ID++}`;
    this._key = Symbol(this._description);
  }
}

export const context = <T>(initialValue: T, description?: string): Context<T> => {
  return new ContextImpl(initialValue, description);
};

export function withContexts<C extends unknown[], U>(contexts: [...ContextPair<C>], fn: () => U): U {
  const prevScope = CURRENT_SCOPE;
  const currentScope = getCurrentScope();

  try {
    CURRENT_SCOPE = currentScope.getChild(contexts as [ContextImpl<unknown>, unknown][]);
    return fn();
  } finally {
    CURRENT_SCOPE = prevScope;
  }
}

export const getContext = <T>(context: Context<T>): T => {
  const scope = CURRENT_SCOPE ?? CURRENT_CONSUMER?.scope;

  if (scope === undefined) {
    throw new Error(
      'getContext must be used within a reactive function, a withContext, or within a framework-specific context provider.',
    );
  }

  return scope.getContext(context) ?? (context as unknown as ContextImpl<T>).defaultValue;
};

// ======= Signal Scope =======

export class SignalScope {
  private parentScope?: SignalScope;

  constructor(contexts: [ContextImpl<unknown>, unknown][], parent?: SignalScope) {
    this.parentScope = parent;
    this.contexts = Object.create(parent?.contexts || null);

    this.setContexts(contexts);
  }

  private contexts: Record<symbol, unknown>;
  private children = new Map<number, SignalScope>();
  private signals = new Map<number, ReactiveFnSignal<any, any>>();
  private gcCandidates = new Set<ReactiveFnSignal<any, any>>();

  setContexts(contexts: [ContextImpl<unknown>, unknown][]) {
    for (const [context, value] of contexts) {
      this.contexts[context._key] = value;

      if (typeof value === 'object' && value !== null) {
        SCOPE_OWNER_MAP.set(value, this);
      }
    }

    this.signals.clear();
  }

  getChild(contexts: [ContextImpl<unknown>, unknown][]) {
    const key = hashValue(contexts);

    let child = this.children.get(key);

    if (child === undefined) {
      child = new SignalScope(contexts, this);
      this.children.set(key, child);
    }

    return child;
  }

  getContext<T>(_context: Context<T>): T | undefined {
    const context = _context as unknown as ContextImpl<T>;

    return this.contexts[context._key] as T | undefined;
  }

  get<T, Args extends unknown[]>(def: ReactiveFnDefinition<T, Args>, args: Args): ReactiveFnSignal<T, Args> {
    const paramKey = def.paramKey?.(...args);
    const key = hashReactiveFn(def.compute, paramKey ? [paramKey] : args);
    let signal = this.signals.get(key) as ReactiveFnSignal<T, Args> | undefined;

    if (signal === undefined) {
      signal = createReactiveFnSignal(def, args, key, this);
      this.signals.set(key, signal);
    }

    return signal;
  }

  markForGc(signal: ReactiveFnSignal<any, any>) {
    if (!this.gcCandidates.has(signal)) {
      this.gcCandidates.add(signal);
      scheduleGcSweep(this);
    }
  }

  removeFromGc(signal: ReactiveFnSignal<any, any>) {
    this.gcCandidates.delete(signal);
  }

  forceGc(signal: ReactiveFnSignal<any, any>) {
    this.signals.delete(signal.key!);
  }

  sweepGc() {
    for (const signal of this.gcCandidates) {
      if (signal.watchCount === 0) {
        this.signals.delete(signal.key!);
      }
    }

    this.gcCandidates = new Set();
  }
}

export let GLOBAL_SCOPE = new SignalScope([]);

export function setGlobalContexts<C extends unknown[], U>(contexts: [...ContextPair<C>]): void {
  GLOBAL_SCOPE.setContexts(contexts as [ContextImpl<unknown>, unknown][]);
}

export const clearGlobalContexts = () => {
  GLOBAL_SCOPE = new SignalScope([]);
};

export let CURRENT_SCOPE: SignalScope | undefined;

export const setCurrentScope = (scope: SignalScope | undefined) => {
  CURRENT_SCOPE = scope;
};

export const getCurrentScope = (fallback = GLOBAL_SCOPE): SignalScope => {
  return CURRENT_SCOPE ?? CURRENT_CONSUMER?.scope ?? fallback;
};

// ======= Owner =======

const SCOPE_OWNER_MAP = new WeakMap<object, SignalScope>();
const OWNER_CHILD_MAP = new WeakMap<object, object>();

export const setScopeOwner = (obj: object, ownerObject: object) => {
  if (OWNER_CHILD_MAP.has(obj)) {
    throw new Error('Object already has a scope owner, owners cannot be dynamic');
  }

  OWNER_CHILD_MAP.set(obj, ownerObject);
};

const reifyScopeOwner = (obj: object): SignalScope => {
  const owner = OWNER_CHILD_MAP.get(obj);

  if (!owner) {
    throw new Error('Object has no scope owner, reactiveMethod must be attached to an owned context object');
  }

  const scope = SCOPE_OWNER_MAP.get(owner) ?? reifyScopeOwner(owner);

  SCOPE_OWNER_MAP.set(obj, scope);

  return scope;
};

export const getScopeOwner = (obj: object): SignalScope => {
  let scope = SCOPE_OWNER_MAP.get(obj);

  if (!scope) {
    scope = reifyScopeOwner(obj);
  }

  return scope;
};

// ======= Test Helper =======

export function forceGc(_signal: object) {
  const signal = _signal as ReactiveFnSignal<any, any>;
  signal.scope?.forceGc(signal);
}
