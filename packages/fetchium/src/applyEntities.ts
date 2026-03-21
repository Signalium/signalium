// -----------------------------------------------------------------------------
// Apply Entities
//
// Single depth-first walk from the root that applies parsed entities to the
// entity store, replaces parsed data objects with entity proxies, and counts
// child refs. Entity fields are reified inline during the merge/init loops
// so there is only one iteration per entity's shape fields.
// -----------------------------------------------------------------------------

import type { QueryClient } from './QueryClient.js';
import type { EntityInstance } from './EntityInstance.js';
import type { ParseContext, ParsedEntity } from './parseEntities.js';
import { FormattedValue, ValidatorDef } from './typeDefs.js';
import { createLiveCollection, LiveCollectionBinding } from './LiveCollection.js';
import { PROXY_ID } from './proxyId.js';

const entries = Object.entries;
const ObjectProto = Object.prototype;

// ======================================================
// Public API
// ======================================================

export interface ApplyResult {
  data: unknown;
  entityRefs: Map<EntityInstance, number>;
}

/**
 * Single depth-first walk from the root that applies entities to the store,
 * replaces parsed data objects with entity proxies, and counts child refs.
 */
export function applyEntityRefs(
  ctx: ParseContext,
  rootData: unknown,
  persist: boolean,
  appendMode: boolean = false,
): ApplyResult {
  const queryClient = ctx.queryClient!;
  queryClient.currentParseId++;

  const seen = ctx.seen!;
  const entityRefs = new Map<EntityInstance, number>();
  const data = reifyAndApply(rootData, seen, queryClient, persist, entityRefs, appendMode);

  return { data, entityRefs };
}

// ======================================================
// Depth-first walk
// ======================================================

function reifyAndApply(
  value: unknown,
  seen: Map<Record<string, unknown>, ParsedEntity>,
  queryClient: QueryClient,
  persist: boolean,
  entityRefs: Map<EntityInstance, number>,
  appendMode: boolean,
): unknown {
  if (typeof value !== 'object' || value === null) return value;

  const entity = seen.get(value as Record<string, unknown>);
  if (entity !== undefined) {
    return applyEntity(entity, seen, queryClient, persist, entityRefs, appendMode);
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      if (typeof item === 'object' && item !== null && !(item instanceof FormattedValue) && !PROXY_ID.has(item)) {
        value[i] = reifyAndApply(item, seen, queryClient, persist, entityRefs, appendMode);
      }
    }
    return value;
  }

  if (Object.getPrototypeOf(value) === ObjectProto && !PROXY_ID.has(value as object)) {
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      const v = obj[key];
      if (typeof v === 'object' && v !== null && !(v instanceof FormattedValue) && !PROXY_ID.has(v)) {
        obj[key] = reifyAndApply(v, seen, queryClient, persist, entityRefs, appendMode);
      }
    }
  }

  return value;
}

function shouldReify(v: unknown): boolean {
  return typeof v === 'object' && v !== null && !(v instanceof FormattedValue) && !PROXY_ID.has(v);
}

// ======================================================
// Entity apply — reify fields + merge data + wire child refs
// ======================================================

function applyEntity(
  entity: ParsedEntity,
  seen: Map<Record<string, unknown>, ParsedEntity>,
  queryClient: QueryClient,
  persist: boolean,
  parentEntityRefs: Map<EntityInstance, number>,
  appendMode: boolean,
): Record<string, unknown> {
  const { key, data, shape: entityShape, rawKeys } = entity;
  const shapeFields = entityShape.shape;

  const entityInstance = queryClient.prepareEntity(key, data, entityShape);
  const existingData = entityInstance.data;
  const isUpdate = existingData !== data;

  // For partial updates (rawKeys defined), seed childRefs with existing refs
  // so unchanged entity-ref fields aren't released by setChildRefs.
  const childRefs =
    isUpdate && rawKeys !== undefined && entityInstance.entityRefs !== undefined
      ? new Map(entityInstance.entityRefs)
      : new Map<EntityInstance, number>();

  if (isUpdate) {
    mergeFields(
      shapeFields,
      data,
      existingData,
      rawKeys,
      entityInstance,
      existingData,
      seen,
      queryClient,
      persist,
      childRefs,
      appendMode,
    );
    entityInstance.notify();
  } else {
    initFields(shapeFields, data, entityInstance, data, seen, queryClient, persist, childRefs, appendMode);
  }

  if (appendMode && entityInstance.liveCollections.length > 0) {
    for (const binding of entityInstance.liveCollections) {
      const raw = binding.instance.getRawValue();
      if (!Array.isArray(raw)) continue;
      for (const item of raw) {
        if (typeof item !== 'object' || item === null) continue;
        const itemKey = PROXY_ID.get(item as object);
        if (itemKey === undefined) continue;
        const child = queryClient.entityMap.getEntity(itemKey);
        if (child !== undefined) {
          childRefs.set(child, (childRefs.get(child) ?? 0) + 1);
        }
      }
    }
  }

  entityInstance.setChildRefs(childRefs.size > 0 ? childRefs : undefined, persist);

  const proxy = entityInstance.getProxy(entityShape);

  parentEntityRefs.set(entityInstance, (parentEntityRefs.get(entityInstance) ?? 0) + 1);

  return proxy;
}

// ======================================================
// Field merge (update path) — reify + merge in one loop
// ======================================================

function mergeFields(
  shape: Record<string, unknown>,
  data: Record<string, unknown>,
  existingData: Record<string, unknown>,
  rawKeys: Set<string> | undefined,
  entityInstance: EntityInstance,
  entityData: Record<string, unknown>,
  seen: Map<Record<string, unknown>, ParsedEntity>,
  queryClient: QueryClient,
  persist: boolean,
  childRefs: Map<EntityInstance, number>,
  appendMode: boolean,
): void {
  for (const [fieldKey, propShape] of entries(shape)) {
    if (rawKeys !== undefined && !rawKeys.has(fieldKey)) continue;

    if (shouldReify(data[fieldKey])) {
      data[fieldKey] = reifyAndApply(data[fieldKey], seen, queryClient, persist, childRefs, appendMode);
    }

    if (propShape instanceof ValidatorDef && propShape._liveConfig !== undefined) {
      const existingValue = existingData[fieldKey];
      if (existingValue instanceof LiveCollectionBinding) {
        if (appendMode) {
          existingValue.append(data[fieldKey]);
        } else {
          existingValue.reset(data[fieldKey]);
        }
      } else {
        existingData[fieldKey] = createLiveCollection(
          propShape._liveConfig,
          data[fieldKey],
          entityInstance,
          entityData,
          queryClient,
        );
      }
    } else {
      const newVal = data[fieldKey];
      const oldVal = existingData[fieldKey];
      if (isPlainObject(newVal) && isPlainObject(oldVal)) {
        const nestedShape =
          propShape instanceof ValidatorDef && propShape.shape !== undefined
            ? (propShape.shape as Record<string, unknown>)
            : undefined;
        if (nestedShape !== undefined) {
          mergeFields(
            nestedShape,
            newVal,
            oldVal,
            undefined,
            entityInstance,
            entityData,
            seen,
            queryClient,
            persist,
            childRefs,
            appendMode,
          );
        } else {
          for (const k of Object.keys(newVal)) {
            oldVal[k] = newVal[k];
          }
        }
        existingData[fieldKey] = oldVal;
      } else {
        existingData[fieldKey] = newVal;
      }
    }
  }
}

// ======================================================
// Field init (new entity path) — reify + create live collections in one loop
// ======================================================

function initFields(
  shape: Record<string, unknown>,
  data: Record<string, unknown>,
  entityInstance: EntityInstance,
  entityData: Record<string, unknown>,
  seen: Map<Record<string, unknown>, ParsedEntity>,
  queryClient: QueryClient,
  persist: boolean,
  childRefs: Map<EntityInstance, number>,
  appendMode: boolean,
): void {
  for (const [fieldKey, propShape] of entries(shape)) {
    if (!(fieldKey in data)) continue;

    if (shouldReify(data[fieldKey])) {
      data[fieldKey] = reifyAndApply(data[fieldKey], seen, queryClient, persist, childRefs, appendMode);
    }

    if (propShape instanceof ValidatorDef && propShape._liveConfig !== undefined) {
      data[fieldKey] = createLiveCollection(
        propShape._liveConfig,
        data[fieldKey],
        entityInstance,
        entityData,
        queryClient,
      );
    } else {
      const val = data[fieldKey];
      if (isPlainObject(val)) {
        const nestedShape =
          propShape instanceof ValidatorDef && propShape.shape !== undefined
            ? (propShape.shape as Record<string, unknown>)
            : undefined;
        if (nestedShape !== undefined) {
          initFields(nestedShape, val, entityInstance, entityData, seen, queryClient, persist, childRefs, appendMode);
        }
      }
    }
  }
}

// ======================================================
// Helpers
// ======================================================

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    Object.getPrototypeOf(v) === ObjectProto &&
    !PROXY_ID.has(v)
  );
}
