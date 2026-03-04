import { describe, expect, test } from 'vitest';
import { notifier, signal, watcher, watchOnce } from 'signalium';
import { reactive } from './utils/instrumented-hooks.js';
import { nextTick, sleep } from './utils/async.js';
import { asyncSettled } from '../internals/scheduling.js';

describe('async graph edge cases', () => {
  test('should not double dirty consumers when awaiting a pending signal (causes an infinite loop)', async () => {
    const state = signal(1);

    const inner = reactive(
      async () => {
        const a = state.value;
        await nextTick();
        return a;
      },
      { desc: 'inner' },
    );

    const middle = reactive(
      async () => {
        await sleep(10);
        return await inner();
      },
      { desc: 'outer1' },
    );

    const outer = reactive(
      async () => {
        const a = await middle();
        return a;
      },
      { desc: 'outer2' },
    );

    await watchOnce(async () => {
      await outer();

      state.value = 2;

      const secondPromise = outer();

      state.value = 3;

      outer();

      const output = await secondPromise;
      expect(output).toBe(3);
    });
  });

  describe('immediate read after sequential writes', () => {
    test.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])(
      'with %i level(s) of nesting, outer awaits inner and reflects sequential writes immediately',
      async (levels: number) => {
        const animals = signal<string[]>([]);

        // Create the base reactive function that reads from the signal
        const reactiveFunctions: Array<() => Promise<string[]>> = [];

        reactiveFunctions.push(
          reactive(
            async () => {
              // Introduce an async boundary that resolves next microtask
              const s = animals.value;
              await nextTick();
              return s;
            },
            { desc: 'getRaw0' },
          ),
        );

        // Create the chain of reactive functions up to the desired level
        for (let i = 1; i < levels; i++) {
          const prevFunction = reactiveFunctions[i - 1];
          reactiveFunctions.push(
            reactive(
              async () => {
                const s = await prevFunction();
                return s;
              },
              { desc: `getRaw${i}` },
            ),
          );
        }

        // Use the outermost function in the chain
        const getOutermost = reactiveFunctions[reactiveFunctions.length - 1];

        const write = (k: string) => {
          const curr = animals.value;
          animals.value = [...curr, k];
        };

        // 1) first write
        write('cat');
        let items = await getOutermost();
        expect(items).toContain('cat');

        // 2) second write
        write('dog');
        items = await getOutermost();
        expect(items).toContain('dog');

        // 3) third write — this has been observed to intermittently fail
        write('fish');
        items = await getOutermost();
        expect(items).toContain('fish');
      },
    );
  });

  test('3-level async chain with concurrent notifier + signal change', async () => {
    const n = notifier();
    const entity = signal(100);
    const storage = signal('data');

    const level0 = reactive(
      async () => {
        n.consume();
        await sleep(10);
        return storage.value;
      },
      { desc: 'level0' },
    );

    const level1 = reactive(
      async () => {
        const res = await level0();
        return res;
      },
      { desc: 'level1' },
    );

    const level2 = reactive(
      async () => {
        const res = await level1();
        return res;
      },
      { desc: 'level2' },
    );

    const consumer = reactive(
      async () => {
        const chainValue = await level2();
        const entityValue = entity.value;
        return `${chainValue}-${entityValue}`;
      },
      { desc: 'consumer' },
    );

    const w = watcher(() => consumer());
    w.addListener(() => {});
    await sleep(50);

    const initial = consumer();
    expect(initial.isResolved).toBe(true);
    expect(initial.value).toBe('data-100');

    // Notify (dirties the chain but value stays the same) and change
    // the entity signal at the same time
    n.notify();
    entity.value = 200;

    await sleep(200);

    const result = consumer();
    expect(result.isPending).toBe(false);
    expect(result.isResolved).toBe(true);
    expect(result.value).toBe('data-200');
  });

  test('3-level async chain recovers after error', async () => {
    const n = notifier();
    const entity = signal(100);
    const shouldError = signal(false);
    const storage = signal('data');

    const level0 = reactive(
      async () => {
        n.consume();
        await sleep(10);
        if (shouldError.value) {
          throw new Error('level0 failure');
        }
        return storage.value;
      },
      { desc: 'level0' },
    );

    const level1 = reactive(
      async () => {
        const res = await level0();
        return res;
      },
      { desc: 'level1' },
    );

    const level2 = reactive(
      async () => {
        const res = await level1();
        return res;
      },
      { desc: 'level2' },
    );

    const consumer = reactive(
      async () => {
        const chainValue = await level2();
        const entityValue = entity.value;
        return `${chainValue}-${entityValue}`;
      },
      { desc: 'consumer' },
    );

    const w = watcher(() => consumer());
    w.addListener(() => {});
    await sleep(50);

    // Initial state: everything resolves
    const initial = consumer();
    expect(initial.isResolved).toBe(true);
    expect(initial.value).toBe('data-100');

    // Trigger an error in the chain
    shouldError.value = true;
    n.notify();

    await sleep(200);

    const errResult = consumer();
    expect(errResult.isPending).toBe(false);
    expect(errResult.isRejected).toBe(true);
    expect(errResult.error).toBeInstanceOf(Error);
    expect((errResult.error as Error).message).toBe('level0 failure');

    // Recover: clear the error and change the entity concurrently
    shouldError.value = false;
    n.notify();
    entity.value = 200;

    await sleep(200);

    const recovered = consumer();
    expect(recovered.isPending).toBe(false);
    expect(recovered.isRejected).toBe(false);
    expect(recovered.isResolved).toBe(true);
    expect(recovered.value).toBe('data-200');
  });
});

describe('combinatorial sync/async tree chaos tests', () => {
  type NodeKind = 'sync' | 'async';

  interface NodeSpec {
    id: string;
    signal?: string;
    notifier?: string;
    children?: NodeSpec[];
  }

  interface TreeDef {
    spec: NodeSpec;
    signals: Record<string, string>;
    notifiers: string[];
  }

  // --- Helpers ---

  function collectNodeIds(spec: NodeSpec): string[] {
    const ids = [spec.id];
    for (const child of spec.children ?? []) ids.push(...collectNodeIds(child));
    return ids;
  }

  function computeExpected(spec: NodeSpec, vals: Map<string, string>): string {
    const parts: string[] = [];
    for (const c of spec.children ?? []) parts.push(computeExpected(c, vals));
    if (spec.signal != null) parts.push(vals.get(spec.signal)!);
    return parts.join('+');
  }

  function allKindAssignments(ids: string[]): Map<string, NodeKind>[] {
    const results: Map<string, NodeKind>[] = [];
    for (let mask = 0; mask < 1 << ids.length; mask++) {
      const map = new Map<string, NodeKind>();
      for (let j = 0; j < ids.length; j++) {
        map.set(ids[j], (mask >> j) & 1 ? 'async' : 'sync');
      }
      results.push(map);
    }
    return results;
  }

  function kindLabel(kinds: Map<string, NodeKind>): string {
    return [...kinds.entries()].map(([id, k]) => `${id}=${k[0]}`).join(' ');
  }

  function sampleKindAssignments(ids: string[]): Map<string, NodeKind>[] {
    const results: Map<string, NodeKind>[] = [];
    const seen = new Set<string>();

    function add(map: Map<string, NodeKind>) {
      const key = ids.map(id => map.get(id)![0]).join('');
      if (seen.has(key)) return;
      seen.add(key);
      results.push(map);
    }

    add(new Map(ids.map(id => [id, 'sync' as NodeKind])));
    add(new Map(ids.map(id => [id, 'async' as NodeKind])));

    for (const target of ids) {
      add(new Map(ids.map(id => [id, (id === target ? 'async' : 'sync') as NodeKind])));
    }

    let seed = 42;
    for (let i = 0; i < 3; i++) {
      const map = new Map<string, NodeKind>();
      for (const id of ids) {
        seed = ((seed * 1103515245 + 12345) & 0x7fffffff) >>> 0;
        map.set(id, ((seed >> 16) & 1) === 0 ? 'sync' : 'async');
      }
      add(map);
    }

    return results;
  }

  function getKindAssignments(ids: string[]): Map<string, NodeKind>[] {
    return ids.length <= 3 ? allKindAssignments(ids) : sampleKindAssignments(ids);
  }

  // --- Graph builder ---

  interface BuiltNode {
    fn: (...args: unknown[]) => unknown;
    isAsync: boolean;
  }

  function buildNode(
    spec: NodeSpec,
    kinds: Map<string, NodeKind>,
    sigs: Map<string, ReturnType<typeof signal<string>>>,
    notifs: Map<string, ReturnType<typeof notifier>>,
  ): BuiltNode {
    const isAsync = kinds.get(spec.id) === 'async';
    const n = spec.notifier ? notifs.get(spec.notifier) : undefined;
    const built = (spec.children ?? []).map(c => buildNode(c, kinds, sigs, notifs));
    const sig = spec.signal ? sigs.get(spec.signal!) : undefined;

    if (isAsync) {
      return {
        fn: reactive(
          async () => {
            n?.consume();
            await sleep(1);
            const parts: string[] = [];
            for (const child of built) parts.push(String(await child.fn()));
            if (sig) parts.push(sig.value);
            return parts.join('+');
          },
          { desc: spec.id },
        ),
        isAsync: true,
      };
    }
    return {
      fn: reactive(
        () => {
          n?.consume();
          const parts: string[] = [];
          for (const child of built) {
            const r = child.fn();
            parts.push(child.isAsync ? String((r as any).value) : String(r));
          }
          if (sig) parts.push(sig.value);
          return parts.join('+');
        },
        { desc: spec.id },
      ),
      isAsync: false,
    };
  }

  // --- Scenario generation ---

  type Mutation = { type: 'set'; signal: string; value: string } | { type: 'notify'; notifier: string };

  interface Scenario {
    name: string;
    steps: Mutation[][];
  }

  function generateScenarios(tree: TreeDef): Scenario[] {
    const sNames = Object.keys(tree.signals);
    const result: Scenario[] = [];
    const leafSignal = sNames[0];
    const hasEntity = 'entity' in tree.signals;

    result.push({
      name: `set ${leafSignal}`,
      steps: [[{ type: 'set', signal: leafSignal, value: `${leafSignal}1` }]],
    });

    for (const n of tree.notifiers) {
      result.push({
        name: `notify ${n} + set ${leafSignal}`,
        steps: [
          [
            { type: 'notify', notifier: n },
            { type: 'set', signal: leafSignal, value: `${leafSignal}1` },
          ],
        ],
      });
    }

    if (hasEntity) {
      result.push({
        name: 'set entity',
        steps: [[{ type: 'set', signal: 'entity', value: 'entity1' }]],
      });

      for (const n of tree.notifiers) {
        result.push({
          name: `notify ${n} + set entity`,
          steps: [
            [
              { type: 'notify', notifier: n },
              { type: 'set', signal: 'entity', value: 'entity1' },
            ],
          ],
        });
      }
    }

    if (sNames.length > 1) {
      result.push({
        name: 'set all signals simultaneously',
        steps: [sNames.map(s => ({ type: 'set' as const, signal: s, value: `${s}1` }))],
      });
    }

    return result;
  }

  // --- Tree shapes ---

  const trees: Record<string, TreeDef> = {
    'chain (3 deep)': {
      spec: {
        id: 'root',
        children: [
          {
            id: 'mid',
            children: [{ id: 'leaf', signal: 'a', notifier: 'n' }],
          },
        ],
      },
      signals: { a: 'a0' },
      notifiers: ['n'],
    },

    fork: {
      spec: {
        id: 'root',
        children: [
          { id: 'left', signal: 'a', notifier: 'n' },
          { id: 'right', signal: 'b' },
        ],
      },
      signals: { a: 'a0', b: 'b0' },
      notifiers: ['n'],
    },

    'asymmetric tree': {
      spec: {
        id: 'root',
        children: [
          {
            id: 'branch',
            notifier: 'n',
            children: [
              { id: 'deepLeft', signal: 'a' },
              { id: 'deepRight', signal: 'b' },
            ],
          },
          { id: 'shallowRight', signal: 'c' },
        ],
      },
      signals: { a: 'a0', b: 'b0', c: 'c0' },
      notifiers: ['n'],
    },

    'chain + direct signal (mirrors original bug)': {
      spec: {
        id: 'consumer',
        signal: 'entity',
        children: [
          {
            id: 'mid',
            children: [{ id: 'leaf', signal: 'data', notifier: 'n' }],
          },
        ],
      },
      signals: { data: 'd0', entity: 'e0' },
      notifiers: ['n'],
    },

    'fork + direct signal': {
      spec: {
        id: 'consumer',
        signal: 'entity',
        children: [
          { id: 'left', signal: 'a', notifier: 'n' },
          { id: 'right', signal: 'b' },
        ],
      },
      signals: { a: 'a0', b: 'b0', entity: 'e0' },
      notifiers: ['n'],
    },
  };

  // --- Subgraph builders for composition ---

  type Subgraph = { spec: NodeSpec; signals: Record<string, string> };

  function chainSub(prefix: string, depth: number, notifier?: string): Subgraph {
    const sigName = `${prefix}_s`;
    const signals = { [sigName]: `${sigName}0` };
    if (depth === 1) {
      return { spec: { id: `${prefix}0`, signal: sigName, notifier }, signals };
    }
    let spec: NodeSpec = { id: `${prefix}${depth - 1}`, signal: sigName, notifier };
    for (let i = depth - 2; i >= 0; i--) {
      spec = { id: `${prefix}${i}`, children: [spec] };
    }
    return { spec, signals };
  }

  function forkSub(prefix: string, width: number, notifier?: string): Subgraph {
    const signals: Record<string, string> = {};
    const children: NodeSpec[] = [];
    for (let i = 0; i < width; i++) {
      const sigName = `${prefix}${i}_s`;
      signals[sigName] = `${sigName}0`;
      children.push({
        id: `${prefix}${i}`,
        signal: sigName,
        notifier: i === 0 ? notifier : undefined,
      });
    }
    return { spec: { id: `${prefix}R`, children }, signals };
  }

  function composeSub(id: string, subs: Subgraph[], opts?: { signal?: string; notifier?: string }): Subgraph {
    const signals: Record<string, string> = {};
    for (const sub of subs) Object.assign(signals, sub.signals);
    if (opts?.signal) signals[opts.signal] = `${opts.signal}0`;
    return {
      spec: {
        id,
        children: subs.map(s => s.spec),
        signal: opts?.signal,
        notifier: opts?.notifier,
      },
      signals,
    };
  }

  // --- Composed trees (generated by sticking subgraphs together) ---

  const compositions: { name: string; build: () => Subgraph }[] = [
    {
      name: 'chain3+fork2+entity',
      build: () => composeSub('root', [chainSub('L', 3, 'n'), forkSub('R', 2)], { signal: 'entity' }),
    },
    {
      name: 'deep3+fork3+entity',
      build: () => {
        let current: Subgraph = forkSub('F', 3, 'n');
        for (let i = 2; i >= 0; i--) {
          current = {
            spec: { id: `N${i}`, children: [current.spec] },
            signals: current.signals,
          };
        }
        return composeSub('root', [current], { signal: 'entity' });
      },
    },
    {
      name: 'chain4+fork3+entity',
      build: () => composeSub('root', [chainSub('L', 4, 'n'), forkSub('R', 3)], { signal: 'entity' }),
    },
    {
      name: 'chain3x3+entity',
      build: () =>
        composeSub('root', [chainSub('A', 3, 'n'), chainSub('B', 3), chainSub('C', 3)], { signal: 'entity' }),
    },
    {
      name: 'chain5+fork3+entity',
      build: () => composeSub('root', [chainSub('D', 5, 'n'), forkSub('W', 3)], { signal: 'entity' }),
    },
  ];

  for (const comp of compositions) {
    const sub = comp.build();
    const nodeCount = collectNodeIds(sub.spec).length;
    trees[`${comp.name} (${nodeCount} nodes)`] = {
      spec: sub.spec,
      signals: sub.signals,
      notifiers: ['n'],
    };
  }

  // --- Run all combinations ---

  for (const [treeName, tree] of Object.entries(trees)) {
    describe(treeName, () => {
      const nodeIds = collectNodeIds(tree.spec);
      const assignments = getKindAssignments(nodeIds);
      const scens = generateScenarios(tree);

      for (const kinds of assignments) {
        describe(kindLabel(kinds), () => {
          for (const scenario of scens) {
            test(scenario.name, async () => {
              const sigMap = new Map(Object.entries(tree.signals).map(([k, v]) => [k, signal(v)] as const));
              const currentVals = new Map(Object.entries(tree.signals));
              const notifMap = new Map(tree.notifiers.map(n => [n, notifier()] as const));

              const root = buildNode(tree.spec, kinds, sigMap, notifMap);

              const w = watcher(() => root.fn());
              w.addListener(() => {});
              await asyncSettled();

              const expected0 = computeExpected(tree.spec, currentVals);
              if (root.isAsync) {
                const r = root.fn() as any;
                expect(r.isResolved).toBe(true);
                expect(r.value).toBe(expected0);
              } else {
                expect(root.fn()).toBe(expected0);
              }

              for (const step of scenario.steps) {
                for (const m of step) {
                  if (m.type === 'set') {
                    sigMap.get(m.signal)!.value = m.value;
                    currentVals.set(m.signal, m.value);
                  } else {
                    notifMap.get(m.notifier)!.notify();
                  }
                }
                await asyncSettled();

                const expected = computeExpected(tree.spec, currentVals);
                if (root.isAsync) {
                  const r = root.fn() as any;
                  expect(r.isPending).toBe(false);
                  expect(r.isResolved).toBe(true);
                  expect(r.value).toBe(expected);
                } else {
                  expect(root.fn()).toBe(expected);
                }
              }
            });
          }
        });
      }
    });
  }
});
