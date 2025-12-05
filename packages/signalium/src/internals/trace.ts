import { scheduleTracer } from './scheduling.js';
import { ReactiveSignal } from './reactive.js';
import { Signal } from '../types.js';

let TRACER: TracerProxy | undefined;

export const getTracerProxy = () => {
  return TRACER;
};

export interface VisualizerLink {
  connected: boolean;
  version: number;
  node: VisualizerNode;
}

export interface TracerMeta {
  id: string | number;
  desc: string;
  params: string;
  tracer?: Tracer;
}

export enum TracerEventType {
  StartUpdate = 'StartUpdate',
  EndUpdate = 'EndUpdate',
  StartLoading = 'StartLoading',
  EndLoading = 'EndLoading',

  Connected = 'Connected',
  Disconnected = 'Disconnected',

  ConsumeState = 'ConsumeState',
}

type StartUpdateEvent = {
  type: TracerEventType.StartUpdate;
  id: string | number;
};

type EndUpdateEvent = {
  type: TracerEventType.EndUpdate;
  id: string | number;
  value: unknown;
  preserveChildren?: boolean;
};

type StartLoadingEvent = {
  type: TracerEventType.StartLoading;
  id: string | number;
};

type EndLoadingEvent = {
  type: TracerEventType.EndLoading;
  id: string | number;
  value: unknown;
};

type ConnectedEvent = {
  type: TracerEventType.Connected;
  id: string | number;
  childId: string | number;
  nodeType: SignalType;
  name?: string;
  params?: string;
};

type DisconnectedEvent = {
  type: TracerEventType.Disconnected;
  id: string | number;
  childId: string | number;
};

type ConsumeStateEvent = {
  type: TracerEventType.ConsumeState;
  id: string | number;
  name: string;
  childId: string | number;
  value: unknown;
  setValue: (value: unknown) => void;
};

type TracerEvent =
  | StartUpdateEvent
  | EndUpdateEvent
  | StartLoadingEvent
  | EndLoadingEvent
  | ConnectedEvent
  | DisconnectedEvent
  | ConsumeStateEvent;

export enum SignalType {
  State = 'state',
  Reactive = 'reactive',
  Watcher = 'watcher',
}

export class VisualizerNode {
  private subscribers: (() => void)[] = [];

  private nextStateChildren: VisualizerNode[] = [];

  public stateChildren: VisualizerNode[] = [];
  public children: VisualizerLink[] = [];
  public updating = true;
  public loading = false;
  public version = 0;

  private updatingVersion = 0;
  private didConnect = false;

  constructor(
    private tracer: Tracer,
    public depth: number,
    public type: SignalType,
    public id: string | number,
    public value: unknown,
    public name?: string,
    public params?: string,
    private _setValue?: (value: unknown) => void,
  ) {
    this.tracer.maxDepth = Math.max(this.tracer.maxDepth, this.depth);
  }

  get showParams() {
    return this.tracer.showParams;
  }

  get showValue() {
    return this.tracer.showValue;
  }

  get interactive() {
    return this.tracer.interactive;
  }

  setValue(value: unknown) {
    if (this.type !== SignalType.State) {
      throw new Error('setValue is only allowed on state nodes');
    }

    this._setValue?.(value);
    this.notify();
    // scheduleTracer(this.tracer);
  }

  connectChild(child: VisualizerNode): boolean {
    let childLink = this.children.find(
      link => link.node.id === child.id || (link.node.name === child.name && link.version !== this.updatingVersion),
    );

    let shouldSkip = false;

    if (childLink) {
      if (!child.didConnect) {
        child.value = childLink.node.value;
        child.children = childLink.node.children.map(link => ({
          ...link,
          version: child.version,
        }));
      }

      childLink.node = child;
      childLink.connected = true;
      childLink.version = this.updatingVersion;
      shouldSkip = true;
    } else {
      this.children.push({
        connected: true,
        node: child,
        version: this.updatingVersion,
      });
    }

    child.didConnect = true;
    this.notify();

    return shouldSkip;
  }

  disconnectChild(childId: string | number) {
    const childLink = this.children.find(link => link.node.id === childId);

    if (!childLink) {
      return;
    }

    childLink.connected = false;

    this.notify();
  }

  startUpdate() {
    this.updating = true;
    this.updatingVersion++;

    this.notify();
  }

  endUpdate(value: unknown, preserveChildren = false) {
    this.updating = false;
    this.value = value;
    if (!preserveChildren) {
      this.stateChildren = this.nextStateChildren;
    }
    this.nextStateChildren = [];
    this.notify();
  }

  startLoading() {
    this.loading = true;
    this.notify();
  }

  endLoading(value: unknown) {
    this.loading = false;
    this.value = value;
    this.notify();
  }

  consumeState(id: string | number, name: string, value: unknown, setValue: (value: unknown) => void) {
    const existing = this.stateChildren.find(child => child.id === id);

    if (existing) {
      existing.value = value;
      this.nextStateChildren.push(existing);
      existing.notify();
    } else {
      const node = new VisualizerNode(
        this.tracer,
        this.depth + 1,
        SignalType.State,
        id,
        value,
        name,
        undefined,
        setValue,
      );
      node.updating = false;
      this.nextStateChildren.push(node);
    }
  }

  notify() {
    this.version++;
    for (const subscriber of this.subscribers) {
      subscriber();
    }
  }

  subscribe(subscriber: () => void) {
    this.subscribers.push(subscriber);

    return () => {
      this.subscribers = this.subscribers.filter(s => s !== subscriber);
    };
  }
}

let ID = 0;

class TraceFlush {
  private forceComplete = false;
  public promise: Promise<void>;
  public id = ID++;
  constructor(tracer: Tracer, queue: TracerEvent[], previousFlush?: TraceFlush) {
    this.promise = this.runFlush(tracer, queue, previousFlush);
  }

  complete() {
    this.forceComplete = true;
    return this.promise;
  }

  private async runFlush(tracer: Tracer, queue: TracerEvent[], previousFlush?: TraceFlush) {
    if (previousFlush) {
      await previousFlush.complete();
    }

    for (let i = 0; i < queue.length; i++) {
      const event = queue[i];
      const nextEvent = queue[i + 1];

      const skipDelay = tracer.handleEvent(event, nextEvent);

      if (!this.forceComplete && !skipDelay && tracer.delay > 0 && !document.hidden) {
        await new Promise(resolve => setTimeout(resolve, tracer.delay));
      }
    }
  }
}

export class Tracer {
  private nodeMap = new Map<string | number, VisualizerNode>();

  delay = 200;
  maxDepth = 0;

  private initialized = false;

  constructor(
    id: string | number,
    immediate = false,
    public showParams = true,
    public showValue = true,
    public interactive = true,
  ) {
    // If it's immediate, we should run the first flush immediately, skipping animations
    this.initialized = !immediate;

    const node = new VisualizerNode(this, 0, SignalType.Watcher, id, '');

    this.rootNode = node;
    this.nodeMap.set(id, node);
  }

  public rootNode: VisualizerNode;

  private eventQueue: TracerEvent[] = [];
  private currentFlush: TraceFlush | undefined;

  emit(event: TracerEvent) {
    if (event.type === TracerEventType.Connected || event.type === TracerEventType.ConsumeState) {
      const node = this.nodeMap.get(event.id);

      if (!node || (event.type === TracerEventType.Connected && !event.name)) {
        return;
      }

      if (!this.nodeMap.has(event.childId)) {
        const name = event.type === TracerEventType.Connected ? event.name : undefined;
        const params = event.type === TracerEventType.Connected ? event.params : undefined;
        const nodeType = event.type === TracerEventType.Connected ? event.nodeType : SignalType.State;

        this.nodeMap.set(
          event.childId,
          new VisualizerNode(this, node.depth + 1, nodeType, event.childId, '', name, params),
        );
      }
    }

    if (event.type === TracerEventType.StartLoading || event.type === TracerEventType.EndLoading) {
      scheduleTracer(this);
    }

    if (this.initialized) {
      this.eventQueue.push(event);
    } else {
      this.handleEvent(event);
    }
  }

  handleEvent(event: TracerEvent, nextEvent?: TracerEvent) {
    const node = this.nodeMap.get(event.id);

    if (!node) {
      return true;
    }

    let skipDelay = nextEvent?.type === TracerEventType.StartLoading;

    if (event.type === TracerEventType.Connected) {
      let child = this.nodeMap.get(event.childId);

      if (!child) {
        throw new Error(`Child node ${event.childId} not found`);
      }

      skipDelay = node.connectChild(child);
    } else if (event.type === TracerEventType.Disconnected) {
      node.disconnectChild(event.childId);
    } else if (event.type === TracerEventType.StartUpdate) {
      node.startUpdate();
      if (
        nextEvent &&
        nextEvent.id === event.id &&
        (nextEvent.type === TracerEventType.EndUpdate || nextEvent.type === TracerEventType.StartLoading)
      ) {
        skipDelay = true;
      }
    } else if (event.type === TracerEventType.EndUpdate) {
      node.endUpdate(event.value, event.preserveChildren);
    } else if (event.type === TracerEventType.StartLoading) {
      node.startLoading();
      skipDelay = true;
    } else if (event.type === TracerEventType.EndLoading) {
      node.endLoading(event.value);
    } else if (event.type === TracerEventType.ConsumeState) {
      node.consumeState(event.childId, event.name, event.value, event.setValue);
    }

    return skipDelay;
  }

  async flush() {
    if (this.eventQueue.length === 0) {
      return;
    }

    this.currentFlush = new TraceFlush(this, this.eventQueue, this.currentFlush);
    this.eventQueue = [];
  }

  addListener(listener: () => void) {
    this.initialized = true;
    return this.rootNode.subscribe(listener);
  }
}

class TracerProxy {
  private tracers: Tracer[] = [];

  constructor() {}

  emit(event: TracerEvent) {
    this.tracers.forEach(tracer => tracer.emit(event));
  }

  createTracer(id: string | number, immediate = false): Tracer {
    const tracer = new Tracer(id, immediate);

    this.tracers.push(tracer);

    return tracer;
  }

  removeTracer(tracer: Tracer) {
    this.tracers = this.tracers.filter(t => t !== tracer);
  }

  flush() {
    this.tracers.forEach(tracer => tracer.flush());
  }
}

export function setTracing(enabled: boolean) {
  if (enabled) {
    TRACER = new TracerProxy();
  } else {
    TRACER = undefined;
  }
}

export function createTracer(_signal: Signal<unknown>, immediate = false) {
  const signal = _signal as unknown as ReactiveSignal<unknown, unknown[]>;
  return createTracerFromId(signal.tracerMeta!.id, immediate);
}

export function createTracerFromId(id: string | number, immediate = false) {
  if (!TRACER) {
    throw new Error('Tracing is not enabled');
  }

  return TRACER.createTracer(id, immediate);
}

export function removeTracer(tracer: Tracer) {
  if (!TRACER) {
    throw new Error('Tracing is not enabled');
  }

  TRACER.removeTracer(tracer);
}
