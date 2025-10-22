export {
  setTracing,
  createTracer,
  createTracerFromId,
  removeTracer,
  VisualizerNode,
  type VisualizerLink,
  TracerEventType,
  Tracer,
  SignalType,
  getTracerProxy,
} from './internals/trace.js';

export { scheduleTracer } from './internals/scheduling.js';
