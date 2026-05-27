import { ReactivePromiseImpl } from './async.js';
import type { ReactiveSignal } from './reactive.js';
import type { ReactiveConsumer } from './consumer.js';

let CURRENT_ORD = 0;

export const enum EdgeType {
  Signal = 0,
  Promise = 1,
}

export interface EdgeTypeDep {
  [EdgeType.Signal]: ReactiveSignal<any, any>;
  [EdgeType.Promise]: ReactivePromiseImpl<any>;
}

export class EdgeBase {
  type: EdgeType;
  dep: EdgeTypeDep[EdgeType];
  ord: number;
  updatedAt: number;
  consumedAt: number;
  nextDirty: Edge | undefined;
  dirtyAt: number;
  subRef: WeakRef<ReactiveConsumer> | undefined;
  sub: ReactiveConsumer | undefined;
  nextSub: Edge | undefined;
  prevSub: Edge | undefined;
  nextDep: Edge | undefined;
  prevDep: Edge | undefined;

  constructor(
    type: EdgeType,
    dep: EdgeTypeDep[EdgeType],
    updatedAt: number,
    consumedAt: number,
    subRef: WeakRef<ReactiveConsumer> | undefined,
    sub: ReactiveConsumer | undefined,
  ) {
    this.type = type;
    this.dep = dep;
    this.ord = CURRENT_ORD++;
    this.updatedAt = updatedAt;
    this.consumedAt = consumedAt;
    this.nextDirty = undefined;
    this.dirtyAt = -1;
    this.subRef = subRef;
    this.sub = sub;
    this.nextSub = undefined;
    this.prevSub = undefined;
    this.nextDep = undefined;
    this.prevDep = undefined;
  }
}

export interface SignalEdge extends EdgeBase {
  type: EdgeType.Signal;
  dep: ReactiveSignal<any, any>;
}

export interface PromiseEdge extends EdgeBase {
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
  subRef?: WeakRef<ReactiveConsumer>,
  sub?: ReactiveConsumer,
): R {
  if (prevEdge === undefined) {
    return new EdgeBase(type, dep, updatedAt, consumedAt, subRef, sub) as R;
  }

  prevEdge.ord = CURRENT_ORD++;
  prevEdge.updatedAt = updatedAt;
  prevEdge.consumedAt = consumedAt;
  prevEdge.nextDirty = undefined;
  if (subRef !== undefined) prevEdge.subRef = subRef;
  if (sub !== undefined) prevEdge.sub = sub;
  return prevEdge as R;
}

export function linkSub(dep: ReactiveSignal<any, any>, edge: Edge): void {
  if (dep.subsHead === edge || edge.prevSub !== undefined) {
    return;
  }

  const head = dep.subsHead;
  edge.nextSub = head;
  edge.prevSub = undefined;

  if (head !== undefined) {
    head.prevSub = edge;
  }

  dep.subsHead = edge;
}

export function linkDep(sub: ReactiveConsumer, edge: Edge): void {
  if (sub.depsHead === edge || edge.prevDep !== undefined) {
    return;
  }

  const head = sub.depsHead;
  edge.nextDep = head;
  edge.prevDep = undefined;

  if (head !== undefined) {
    head.prevDep = edge;
  }

  sub.depsHead = edge;
}

export function unlinkDep(sub: ReactiveConsumer, edge: Edge): void {
  const next = edge.nextDep;
  const prev = edge.prevDep;

  if (sub.depsHead === edge) {
    sub.depsHead = next;
  }

  if (prev !== undefined) {
    prev.nextDep = next;
  }

  if (next !== undefined) {
    next.prevDep = prev;
  }

  edge.nextDep = undefined;
  edge.prevDep = undefined;
  edge.sub = undefined;
}

export function prepareDeps(sub: ReactiveConsumer): void {
  let edge = sub.depsHead;

  while (edge !== undefined) {
    if (edge.type === EdgeType.Signal) {
      edge.dep.activeEdge = edge;
    }
    edge = edge.nextDep;
  }
}

export function findDepEdge(sub: ReactiveConsumer, dep: ReactiveSignal<any, any>): Edge | undefined {
  const active = dep.activeEdge;
  if (active !== undefined && active.subRef === sub.ref) {
    return active;
  }

  let edge = sub.depsHead;
  while (edge !== undefined) {
    if (edge.type === EdgeType.Signal && edge.dep === dep) {
      dep.activeEdge = edge;
      return edge;
    }
    edge = edge.nextDep;
  }

  return undefined;
}

export function unlinkSub(dep: ReactiveSignal<any, any>, edge: Edge): void {
  const next = edge.nextSub;
  const prev = edge.prevSub;

  if (dep.subsHead === edge) {
    dep.subsHead = next;
  }

  if (prev !== undefined) {
    prev.nextSub = next;
  }

  if (next !== undefined) {
    next.prevSub = prev;
  }

  edge.nextSub = undefined;
  edge.prevSub = undefined;
}

export function clearSubLinks(dep: ReactiveSignal<any, any>): void {
  let edge = dep.subsHead;
  dep.subsHead = undefined;

  while (edge !== undefined) {
    const next = edge.nextSub;
    edge.nextSub = undefined;
    edge.prevSub = undefined;
    edge = next;
  }
}

export function findAndRemoveDirty(
  sub: ReactiveConsumer,
  dep: ReactiveSignal<any, any> | ReactivePromiseImpl<any>,
): Edge | undefined {
  let edge = sub.dirtyHead;

  if (edge === undefined) {
    return undefined;
  }

  if (edge.dep === dep) {
    sub.dirtyHead = edge.nextDirty;
    edge.nextDirty = undefined;
    edge.dirtyAt = -1;
    return edge;
  }

  let nextLink = edge.nextDirty;

  while (nextLink !== undefined) {
    if (nextLink.dep === dep) {
      edge.nextDirty = nextLink.nextDirty;
      nextLink.nextDirty = undefined;
      nextLink.dirtyAt = -1;
      return nextLink;
    }

    edge = nextLink;
    nextLink = edge.nextDirty;
  }

  return undefined;
}
