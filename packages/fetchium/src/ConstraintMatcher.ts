import { hashValue } from 'signalium/utils';
import { isFieldRef, getFieldRefPath, resolveFieldRefPath } from './fieldRef.js';
import type { LiveCollectionBinding } from './LiveCollection.js';

// ======================================================
// Constants
// ======================================================

export const EVENT_SOURCE_FIELD = '__eventSource';

// ======================================================
// Constraint Hash Computation
// ======================================================

/**
 * Pre-computed field path: original field name + split segments (for dotted paths).
 */
export interface FieldPath {
  field: string;
  segments: string[] | undefined;
}

export function buildFieldPath(field: string): FieldPath {
  return { field, segments: field.indexOf('.') !== -1 ? field.split('.') : undefined };
}

export function buildFieldPaths(fields: string[]): FieldPath[] {
  return fields.map(buildFieldPath);
}

function resolveFieldPath(data: Record<string, unknown>, fp: FieldPath): unknown {
  if (fp.segments === undefined) return data[fp.field];
  let current: unknown = data;
  for (const segment of fp.segments) {
    if (current === undefined || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Compute a constraint hash from an entity's data given pre-computed field paths.
 * Returns undefined if any constraint field is missing from the entity data.
 */
export function computeConstraintHash(
  entityData: Record<string, unknown>,
  fieldPaths: FieldPath[],
): number | undefined {
  const values: unknown[] = [];
  for (let i = 0; i < fieldPaths.length; i++) {
    const fp = fieldPaths[i];
    const val = resolveFieldPath(entityData, fp);
    if (val === undefined) return undefined;
    values.push(fp.field, val);
  }
  return hashValue(values);
}

/**
 * Resolve constraint FieldRefs against a data object to produce concrete constraint
 * hashes. Used when creating a LiveArrayInstance/LiveValueInstance to compute the
 * hash under which it should be registered.
 */
export function resolveConstraintHashes(
  constraintFieldRefs: Map<string, Array<[string, unknown]>> | undefined,
  parentData: Record<string, unknown>,
): Map<string, number> | undefined {
  if (constraintFieldRefs === undefined) return undefined;

  const result = new Map<string, number>();

  for (const [typename, pairs] of constraintFieldRefs) {
    const sorted = pairs.slice().sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const resolved: unknown[] = [];
    let valid = true;

    for (const [field, ref] of sorted) {
      let value: unknown;
      if (isFieldRef(ref)) {
        const path = getFieldRefPath(ref);
        value = resolveFieldRefPath(path, parentData);
      } else {
        value = ref;
      }
      if (value === undefined) {
        valid = false;
        break;
      }
      resolved.push(field, value);
    }

    if (valid) {
      result.set(typename, hashValue(resolved));
    }
  }

  return result.size > 0 ? result : undefined;
}

function getFieldNames(fieldRefs: Map<string, Array<[string, unknown]>>, typename: string): string[] | undefined {
  const pairs = fieldRefs.get(typename);
  if (pairs === undefined) return undefined;
  return pairs.map(([field]) => field).sort();
}

// ======================================================
// ConstraintGroup — collections sharing the same field set
// ======================================================

export class ConstraintGroup {
  fields: string[];
  fieldPaths: FieldPath[];
  private _bindings: Map<number, Set<LiveCollectionBinding>> = new Map();

  constructor(fields: string[]) {
    this.fields = fields;
    this.fieldPaths = fields.map(buildFieldPath);
  }

  register(constraintHash: number, binding: LiveCollectionBinding): void {
    let set = this._bindings.get(constraintHash);
    if (set === undefined) {
      set = new Set();
      this._bindings.set(constraintHash, set);
    }
    set.add(binding);
  }

  unregister(constraintHash: number, binding: LiveCollectionBinding): void {
    const set = this._bindings.get(constraintHash);
    if (set !== undefined) {
      set.delete(binding);
      if (set.size === 0) {
        this._bindings.delete(constraintHash);
      }
    }
  }

  getMatching(constraintHash: number): Set<LiveCollectionBinding> | undefined {
    return this._bindings.get(constraintHash);
  }

  get isEmpty(): boolean {
    return this._bindings.size === 0;
  }
}

// ======================================================
// ConstraintMatcher (per-typename)
// ======================================================

function fieldSetKey(fields: string[]): number {
  return hashValue(fields); // fields are already sorted by getFieldNames
}

export class ConstraintMatcher {
  private _groups: Map<number, ConstraintGroup> = new Map();

  private getOrCreateGroup(fields: string[]): ConstraintGroup {
    const key = fieldSetKey(fields);
    let group = this._groups.get(key);
    if (group === undefined) {
      group = new ConstraintGroup(fields);
      this._groups.set(key, group);
    }
    return group;
  }

  register(constraintHash: number, fields: string[], binding: LiveCollectionBinding): void {
    this.getOrCreateGroup(fields).register(constraintHash, binding);
  }

  unregister(constraintHash: number, fields: string[], binding: LiveCollectionBinding): void {
    const key = fieldSetKey(fields);
    const group = this._groups.get(key);
    if (group !== undefined) {
      group.unregister(constraintHash, binding);
      if (group.isEmpty) {
        this._groups.delete(key);
      }
    }
  }

  registerBinding(binding: LiveCollectionBinding, typename: string): void {
    const hash = binding._constraintHashes.get(typename);
    if (hash === undefined) return;

    const fields = getFieldNames(binding._constraintFieldRefs, typename);
    if (fields !== undefined) {
      this.register(hash, fields, binding);
    }
  }

  unregisterBinding(binding: LiveCollectionBinding, typename: string): void {
    const hash = binding._constraintHashes.get(typename);
    if (hash === undefined) return;

    const fields = getFieldNames(binding._constraintFieldRefs, typename);
    if (fields !== undefined) {
      this.unregister(hash, fields, binding);
    }
  }

  routeEvent(
    typename: string,
    entityData: Record<string, unknown>,
    entityKey: number,
    eventType: 'create' | 'update' | 'delete',
    onMatch?: () => void,
    deleteData?: Record<string, unknown>,
  ): void {
    for (const group of this._groups.values()) {
      const hash = computeConstraintHash(entityData, group.fieldPaths);
      if (hash === undefined) continue;

      const bindings = group.getMatching(hash);
      if (bindings !== undefined) {
        for (const binding of bindings) {
          binding.onEvent(typename, entityKey, eventType, onMatch, deleteData);
        }
      }
    }
  }
}
