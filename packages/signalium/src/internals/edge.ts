import { ReactivePromiseImpl } from './async.js';
import type { ReactiveSignal } from './reactive.js';

let CURRENT_ORD = 0;

export const enum EdgeType {
  Signal = 0,
  Promise = 1,
}

export interface EdgeTypeDep {
  [EdgeType.Signal]: ReactiveSignal<any, any>;
  [EdgeType.Promise]: ReactivePromiseImpl<any>;
}

interface BaseEdge {
  type: EdgeType;
  dep: EdgeTypeDep[EdgeType];
  ord: number;
  updatedAt: number;
  consumedAt: number;

  nextDirty: Edge | undefined;
}

export interface SignalEdge extends BaseEdge {
  type: EdgeType.Signal;
  dep: ReactiveSignal<any, any>;
}

export interface PromiseEdge extends BaseEdge {
  type: EdgeType.Promise;
  dep: ReactivePromiseImpl<any>;
}

export type Edge = SignalEdge | PromiseEdge;

export function createEdge<T extends EdgeType, R extends T extends EdgeType.Signal ? SignalEdge : PromiseEdge>(
  prevEdge: Edge | undefined,
  type: T,
  dep: EdgeTypeDep[T],
  updatedAt: number,
  consumedAt: number,
): R {
  if (prevEdge === undefined) {
    return {
      type,
      dep,
      ord: CURRENT_ORD++,
      updatedAt,
      consumedAt,
      nextDirty: undefined,
    } as R;
  }

  prevEdge.ord = CURRENT_ORD++;
  prevEdge.updatedAt = updatedAt;
  prevEdge.consumedAt = consumedAt;
  prevEdge.nextDirty = undefined;
  return prevEdge as R;
}

export function insertDirty(node: ReactiveSignal<any, any>, edge: Edge) {
  const ord = edge.ord;
  let currentEdge = node.dirtyHead;

  if (currentEdge === undefined || currentEdge.ord > ord) {
    node.dirtyHead = edge;
  } else {
    let nextEdge = currentEdge.nextDirty;

    while (nextEdge !== undefined && nextEdge.ord < ord) {
      currentEdge = nextEdge;
      nextEdge = currentEdge.nextDirty;
    }

    if (nextEdge === edge) {
      throw new Error('Edge already inserted');
    }
    currentEdge.nextDirty = edge;
  }
}

export function findAndRemoveDirty(
  sub: ReactiveSignal<any, any>,
  dep: ReactiveSignal<any, any> | ReactivePromiseImpl<any>,
): Edge | undefined {
  let edge = sub.dirtyHead;

  if (edge === undefined) {
    return undefined;
  }

  if (edge.dep === dep) {
    sub.dirtyHead = edge.nextDirty;
    return edge;
  }

  let nextLink = edge.nextDirty;

  while (nextLink !== undefined) {
    if (nextLink.dep === dep) {
      edge.nextDirty = nextLink.nextDirty;
      return nextLink;
    }

    edge = nextLink;
    nextLink = edge.nextDirty;
  }

  return undefined;
}
