import { ReactivePromise } from './async.js';
import type { ReactiveFnSignal } from './reactive.js';

let CURRENT_ORD = 0;

export const enum EdgeType {
  Signal = 0,
  Promise = 1,
}

export interface EdgeTypeDep {
  [EdgeType.Signal]: ReactiveFnSignal<any, any>;
  [EdgeType.Promise]: ReactivePromise<any>;
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
  dep: ReactiveFnSignal<any, any>;
}

export interface PromiseEdge extends BaseEdge {
  type: EdgeType.Promise;
  dep: ReactivePromise<any>;
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

export function insertDirty(node: ReactiveFnSignal<any, any>, edge: Edge) {
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

    currentEdge.nextDirty = edge;
  }
}

export function findAndRemoveDirty(
  sub: ReactiveFnSignal<any, any>,
  dep: ReactiveFnSignal<any, any> | ReactivePromise<any>,
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
