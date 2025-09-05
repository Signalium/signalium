import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  SignalScope,
  watcher,
  relay,
  reactive,
  signal,
  ReactivePromise,
  isReactivePromise,
} from 'signalium';
import {
  createTracerFromId,
  setTracing,
  Tracer,
  VisualizerNode,
  SignalType,
} from 'signalium/debug';
import { useReactive } from 'signalium/react';
import clsx from 'clsx';
import { transform } from '@babel/standalone';
import { dedent } from '@/lib/string';
import { CodeFence } from './Fence';
import { createHookWatcher, reactiveHook, useState } from '@/lib/hooks-tracer';
import { addDescOptions, addHooksWrapper } from './visualizer/babel';
import {
  signaliumAsyncTransform,
  signaliumPromiseMethodsTransform,
} from 'signalium/transform';

const item = {
  visible: { opacity: 1, y: 0 },
  hidden: { opacity: 0, y: 20 },
  hideAgain: { opacity: 0, y: -20 },
};

setTracing(true);

type VisualizerNodeState =
  | 'inactive'
  | 'active'
  | 'loading'
  | 'updating'
  | 'success'
  | 'error';

function useTimedBool(memo: unknown[], timeout = 300) {
  const [bool, setBool] = useState(false);

  useEffect(() => {
    setBool(true);

    setTimeout(() => {
      setBool(false);
    }, timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, memo);

  return bool;
}

function useNodeClass(
  node: VisualizerNode,
  classes: Partial<Record<VisualizerNodeState, string>>,
  memo: unknown[],
) {
  const forceUpdating = useTimedBool(memo);

  const loading = node.loading;
  const updating = node.updating || forceUpdating;
  const success = isReactivePromise(node.value) && node.value.isResolved;
  const error = isReactivePromise(node.value) && node.value.isRejected;

  if (loading) {
    return classes.loading;
  } else if (updating) {
    return classes.updating;
  } else if (success) {
    return classes.success;
  } else if (error) {
    return classes.error;
  }

  return classes.inactive;
}

export const VisualizerNodeComponent = ({ node }: { node: VisualizerNode }) => {
  useSyncExternalStore(
    (onStoreChange) => {
      return node.subscribe(() => onStoreChange());
    },
    () => node.version,
    () => node.version,
  );

  const isPromise = isReactivePromise(node.value);
  const params = node.params;
  const value = isPromise
    ? (node.value as ReactivePromise<unknown>).value
    : node.value;

  const nodeClass = useNodeClass(
    node,
    {
      loading: 'border-yellow-400/20 bg-yellow-400/10 text-yellow-500',
      updating: 'border-secondary-200/40 bg-secondary-400/40',
      success: 'border-primary-400/30 bg-primary-400/10 text-primary-300',
      error: 'border-primary-400/30 bg-primary-400/10 text-primary-300',
      inactive: 'border-primary-400/30 bg-primary-400/10 text-primary-300',
    },
    [params, value],
  );

  return (
    <motion.div
      variants={item}
      initial="hidden"
      animate="visible"
      exit="hideAgain"
      transition={{ duration: 0.3 }}
      className="grow-1 font-mono"
    >
      <div className="flex flex-row items-end justify-stretch gap-2 px-1 lg:px-4">
        <AnimatePresence mode="sync" propagate={true}>
          {node.stateChildren.map((child) => (
            <VisualizerNodeComponent
              key={child.name ?? child.id}
              node={child}
            />
          ))}
          {node.children.map((child) => (
            <VisualizerNodeComponent
              key={child.node.name ?? child.node.id}
              node={child.node}
            />
          ))}
        </AnimatePresence>
      </div>
      <div
        className={clsx(
          'relative mb-2 flex min-w-0 flex-row items-center justify-between overflow-hidden rounded-3xl border px-4 py-2 text-xs font-medium transition-colors duration-300',
          nodeClass,
          node.type === SignalType.State && 'border-dashed',
        )}
      >
        <div className="flex-grow">
          <span className="block min-w-fit whitespace-nowrap lg:pr-4">
            {node.name ?? node.id}
            {node.type !== SignalType.State && node.showParams && (
              <>({node.params})</>
            )}
          </span>

          {node.showValue && (
            <>
              <div className="relative py-1.5">
                <span className="whitespace-nowraps absolute top-0 left-0 w-full overflow-hidden text-[0.85em] leading-[1.25] text-ellipsis">
                  val:&nbsp;{String(value)}
                </span>
              </div>
            </>
          )}
        </div>

        {node.type === SignalType.State &&
          node.interactive &&
          typeof node.value === 'number' && (
            <div className="flex flex-row gap-1">
              <button
                onClick={() => node.setValue((node.value as number) + 1)}
                className="flex h-7 w-7 flex-row items-center justify-center gap-1 rounded-full bg-primary-400/30 text-indigo-400 hover:cursor-pointer hover:bg-primary-400/50"
              >
                <span className="mb-0.5 text-xl leading-none">+</span>
              </button>
              <button
                onClick={() => node.setValue((node.value as number) - 1)}
                className="flex h-7 w-7 flex-row items-center justify-center gap-1 rounded-full bg-primary-400/30 py-0 text-indigo-400 hover:cursor-pointer hover:bg-primary-400/50"
              >
                <span className="mb-0.5 text-xl leading-none">-</span>
              </button>
            </div>
          )}

        {isPromise && (
          <span
            className={clsx(
              'loader h-4 w-4',
              node.loading && 'opacity-100',
              !node.loading && 'opacity-0',
            )}
          ></span>
        )}
      </div>
    </motion.div>
  );
};

type WatcherProxy = {
  run?: () => void;
  unsub?: () => void;
};

type createWatcher = (
  tracer: Tracer,
  fn: () => React.ReactNode,
  id: string,
  desc: string,
  scope: SignalScope,
) => WatcherProxy;

const createSignalWatcher: createWatcher = (tracer, fn, id, desc, scope) => {
  const w = watcher(
    () => {
      const value = fn();

      return value;
    },
    {
      id,
      desc,
      scope,
      equals: false,
      tracer,
    },
  );

  const unsub = w.addListener(() => {});

  return {
    unsub,
  };
};

function TrafficLightsIcon(props: React.ComponentPropsWithoutRef<'svg'>) {
  return (
    <svg aria-hidden="true" viewBox="0 0 42 10" fill="none" {...props}>
      <circle cx="5" cy="5" r="4.5" />
      <circle cx="21" cy="5" r="4.5" />
      <circle cx="37" cy="5" r="4.5" />
    </svg>
  );
}

export function RootVisualizerNode({
  tracer,
  onInit,
  initialized,
  source,
  showGradients = false,
  showCode,
}: {
  tracer: Tracer;
  onInit: () => void;
  initialized: boolean;
  source: string;
  showGradients?: boolean;
  showCode?: 'before' | 'after' | 'tab' | false;
}) {
  useSyncExternalStore(
    (onStoreChange) => {
      let unsubTracer: () => void;

      sleep(0).then(() => {
        unsubTracer = tracer.addListener(() => {
          onStoreChange();
        });
      });

      return () => {
        unsubTracer?.();
      };
    },
    () => tracer.rootNode.version,
    () => tracer.rootNode.version,
  );

  const showFlash = useTimedBool([tracer.rootNode.value], 500);

  const [activeTab, setActiveTab] = useState<'Output' | 'Code'>('Output');

  const tabs = [
    { name: 'Output', isActive: activeTab === 'Output' },
    { name: 'Code', isActive: activeTab === 'Code' },
  ] as const;

  let nodeHeight = 42;

  if (tracer.showValue) {
    nodeHeight += 12;
  }

  return (
    <div>
      {showCode === 'before' && (
        <CodeFence language="jsx" className="mb-4 text-sm">
          {source}
        </CodeFence>
      )}

      <div
        style={{
          minHeight: `${tracer.maxDepth * nodeHeight}px`,
        }}
        className="flex flex-col justify-end overflow-x-scroll transition-all duration-1000"
      >
        <div className="flex flex-row items-end justify-stretch">
          {tracer.rootNode.children.map((child) => (
            <VisualizerNodeComponent
              key={child.node.name ?? child.node.id}
              node={child.node}
            />
          ))}
        </div>
      </div>
      <div className="relative">
        <div
          className={clsx(
            'relative rounded-2xl border bg-primary-1000 transition-all duration-1000',
            showFlash
              ? 'border-secondary-200/40 bg-secondary-400/40'
              : 'border-divider',
          )}
        >
          {showGradients && (
            <>
              <div className="absolute -top-px right-11 left-20 h-px bg-linear-to-r from-secondary-300/0 via-secondary-300/70 to-secondary-300/0" />
              <div className="absolute right-20 -bottom-px left-11 h-px bg-linear-to-r from-secondary-400/0 via-secondary-400/70 to-secondary-400/0" />
            </>
          )}

          <div
            className={clsx(
              'relative flex items-center space-x-2 px-4 pt-4 pb-3 text-xs',
            )}
          >
            <div className="mr-4">
              <TrafficLightsIcon className="h-2.5 w-auto stroke-primary-500/30" />
            </div>
            {showCode === 'tab' &&
              tabs.map((tab) => (
                <button
                  key={tab.name}
                  className={clsx(
                    'group flex h-6 rounded-full p-px',
                    tab.isActive
                      ? 'bg-linear-to-r from-secondary-400/30 via-secondary-400/70 to-secondary-400/30 font-medium text-secondary-300'
                      : 'text-primary-300/70 transition-all hover:cursor-pointer hover:bg-linear-to-r hover:from-secondary-400/30 hover:via-secondary-400/70 hover:to-secondary-400/30 hover:text-secondary-300',
                  )}
                  onClick={() => setActiveTab(tab.name)}
                >
                  <div
                    className={clsx(
                      'flex items-center rounded-full px-2.5',
                      tab.isActive
                        ? 'bg-primary-950'
                        : 'group-hover:bg-primary-900',
                    )}
                  >
                    {tab.name}
                  </div>
                </button>
              ))}
          </div>
          <div
            className={clsx(
              'relative min-h-0 rounded-b-2xl px-4 pb-4 transition-all duration-800',
              activeTab === 'Code' && 'min-h-[400px]',
            )}
          >
            <div className={clsx('min-h-[80px] transition-all duration-1000')}>
              {initialized ? (
                (tracer.rootNode.value as React.ReactNode)
              ) : (
                <div className="flex flex-col px-4 py-16 text-center text-2xl">
                  <div>
                    <button
                      className="rounded-full bg-primary-400/30 px-4 py-2 text-primary-400 hover:cursor-pointer hover:bg-primary-400/50"
                      onClick={() => onInit()}
                    >
                      Start
                    </button>
                  </div>
                </div>
              )}
            </div>
            {showCode === 'tab' && (
              <div
                className={clsx(
                  'absolute inset-0 overflow-hidden rounded-b-2xl bg-primary-1000 p-4 text-xs opacity-0 transition-opacity md:text-sm',
                  activeTab === 'Code' && 'overflow-scroll opacity-100',
                )}
              >
                <CodeFence language="jsx">{source}</CodeFence>
              </div>
            )}
          </div>
        </div>
      </div>

      {showCode === 'after' && (
        <CodeFence language="jsx" className="mb-4 text-sm">
          {source}
        </CodeFence>
      )}
    </div>
  );
}

let WATCHER_ID = 0;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const WatcherRunner = ({
  tracer,
  tracerId,
  source,
  wrapOutput,
  reactHooks,
}: {
  tracer: Tracer;
  tracerId: string;
  source: string;
  wrapOutput: boolean;
  reactHooks: boolean;
}) => {
  const createWatcher = reactHooks ? createHookWatcher : createSignalWatcher;

  const watcherRef = useRef<WatcherProxy | undefined>(undefined);

  if (watcherRef.current === undefined) {
    const scope = new SignalScope([]);

    const preamble = `import { relay, reactive, task } from 'signalium';`;

    const sourceWithPreamble =
      preamble + source.replace(/import .* from .*;?/, '');

    const compiled = transform(sourceWithPreamble, {
      presets: ['react'],
      plugins: [
        addDescOptions,
        addHooksWrapper,
        signaliumAsyncTransform(),
        signaliumPromiseMethodsTransform(),
      ],
    })
      .code!.replace('export default function', 'return function')
      .replace(/export const (\w+) =/, 'return')
      .replace(/import .* from .*;?/, '');

    let output = new Function(
      '{ signal, relay, reactive, useReactive, hook, useRef, useState, useEffect, React, sleep, ReactivePromise }',
      compiled,
    )({
      signal,
      relay,
      reactive,
      hook: reactiveHook,
      useRef,
      useState,
      useEffect,
      useReactive,
      React,
      sleep,
      ReactivePromise,
    });

    if (wrapOutput) {
      let originalOutput = output;
      output = () => {
        return (
          <div className="flex flex-col px-4 py-16 text-center text-2xl">
            <div>Output: {String(originalOutput())}</div>
          </div>
        );
      };
    }

    watcherRef.current = createWatcher(
      tracer,
      output,
      tracerId,
      'Output',
      scope,
    );
  }

  watcherRef.current?.run?.();

  useEffect(() => {
    return watcherRef.current?.unsub;
  });

  return '';
};

export function HooksVisualizer({
  reactHooks = false,
  showParams = true,
  showValue = true,
  showCode = 'before',
  wrapOutput = false,
  initialized = false,
  interactive = true,
  showGradients = false,
  source,
}: {
  reactHooks?: boolean;
  showParams?: boolean;
  showValue?: boolean;
  showCode?: 'before' | 'after' | 'tab' | false;
  wrapOutput?: boolean;
  initialized?: boolean;
  interactive?: boolean;
  showGradients?: boolean;
  source: string;
}) {
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  const [shouldInitialize, setShouldInitialize] = useState(initialized);

  const [tracerId] = useState(`Output-${WATCHER_ID++}`);
  const tracerRef = useRef<Tracer | undefined>(undefined);

  if (!hasMounted) return null;

  if (tracerRef.current === undefined) {
    const tracer = createTracerFromId(tracerId, shouldInitialize);

    tracer.showParams = showParams;
    tracer.showValue = showValue;
    tracer.interactive = interactive;

    tracerRef.current = tracer;
  }

  return (
    <>
      {shouldInitialize && (
        <WatcherRunner
          tracer={tracerRef.current!}
          tracerId={tracerId}
          source={dedent(source)}
          wrapOutput={wrapOutput}
          reactHooks={reactHooks}
        />
      )}
      <RootVisualizerNode
        tracer={tracerRef.current!}
        initialized={shouldInitialize}
        onInit={() => setShouldInitialize(true)}
        source={dedent(source)}
        showCode={showCode}
        showGradients={showGradients}
      />
    </>
  );
}
