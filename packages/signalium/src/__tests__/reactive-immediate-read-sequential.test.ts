import { describe, expect, test } from 'vitest';
import { signal, watcher } from 'signalium';
import { reactive } from './utils/instrumented-hooks.js';
import { nextTick, sleep } from './utils/async.js';

// ─── Debug utility: log the full signal dependency tree ───

const STATE_NAMES: Record<number, string> = {
  0: 'Clean',
  1: 'Pending',
  2: 'Dirty',
  3: 'MaybeDirty',
  4: 'PendingDirty',
};

function logSignalTree(promiseOrSignal: any, label?: string, stateSignals?: Record<string, any>) {
  const visited = new Set<any>();
  const lines: string[] = [];

  function line(indent: number, text: string) {
    lines.push('  '.repeat(indent) + text);
  }

  function fmtPromise(p: any, indent: number) {
    const f: number = p['_flags'];
    const pending = !!(f & 1);
    const rejected = !!(f & (1 << 1));
    const resolved = !!(f & (1 << 2));
    const ready = !!(f & (1 << 3));

    line(indent, `[ReactivePromise]  pending=${pending}  resolved=${resolved}  ready=${ready}  rejected=${rejected}`);
    line(indent, `  value: ${JSON.stringify(p['_value'])}`);
    line(indent, `  _updatedCount: ${p['_updatedCount']}`);

    const awaitSubs: Map<any, any> = p['_awaitSubs'];
    line(indent, `  _awaitSubs (${awaitSubs.size}):`);
    for (const [ref, edge] of awaitSubs) {
      const sig = ref.deref?.();
      const desc = sig?.def?.desc ?? sig?.id ?? '??';
      line(
        indent,
        `    <- ${desc}  (edge type=${edge.type === 0 ? 'Signal' : 'Promise'}, updatedAt=${edge.updatedAt}, consumedAt=${edge.consumedAt})`,
      );
    }

    const pendingList: any[] = p['_pending'];
    line(indent, `  _pending (${pendingList.length}):`);
    for (const item of pendingList) {
      const sig = item.ref?.deref?.();
      const desc = sig?.def?.desc ?? sig?.id ?? '(no ref)';
      line(indent, `    <- ${desc}`);
    }
  }

  function fmtSignal(sig: any, indent: number) {
    if (visited.has(sig)) {
      line(indent, `[circular -> ${sig.def?.desc ?? sig.id}]`);
      return;
    }
    visited.add(sig);

    const desc = sig.def?.desc ?? `signal#${sig.id}`;
    const stateNum: number = sig['_state'];
    const state = STATE_NAMES[stateNum] ?? `?(${stateNum})`;

    line(indent, `[${desc}]  id=${sig.id}`);
    // line(indent, `  state: ${state}`);
    // line(
    //   indent,
    //   `  updatedCount=${sig.updatedCount}  computedCount=${sig.computedCount}  watchCount=${sig.watchCount}`,
    // );

    // ── value ──
    // const val = sig['_value'];
    // if (val != null && typeof val === 'object' && '_awaitSubs' in val) {
    //   fmtPromise(val, indent + 1);
    // } else {
    //   line(indent, `  value: ${JSON.stringify(val)}`);
    // }

    // ── dirty head chain ──
    // let dirtyEdge = sig.dirtyHead;
    // if (dirtyEdge) {
    //   line(indent, `  dirtyHead chain:`);
    //   while (dirtyEdge) {
    //     const etype = dirtyEdge.type === 0 ? 'Signal' : 'Promise';
    //     let depDesc: string;
    //     if (dirtyEdge.type === 0) {
    //       depDesc = dirtyEdge.dep?.def?.desc ?? dirtyEdge.dep?.id ?? '??';
    //     } else {
    //       const pSig = dirtyEdge.dep?.['_signal'];
    //       depDesc = `promise(of ${pSig?.def?.desc ?? pSig?.id ?? '??'})`;
    //     }
    //     line(
    //       indent,
    //       `    [${etype}] ${depDesc}  (updatedAt=${dirtyEdge.updatedAt}, consumedAt=${dirtyEdge.consumedAt}, ord=${dirtyEdge.ord})`,
    //     );
    //     dirtyEdge = dirtyEdge.nextDirty;
    //   }
    // }

    // ── deps (what this signal consumes) ──
    const deps: Map<any, any> = sig.deps;
    // line(indent, `  deps (${deps.size}):`);
    for (const [dep, edge] of deps) {
      const etype = edge.type === 0 ? 'Signal' : 'Promise';
      const depDesc = dep.def?.desc ?? dep.id;
      // line(
      //   indent,
      //   `    [${etype}] -> ${depDesc}  (updatedAt=${edge.updatedAt}, consumedAt=${edge.consumedAt}, ord=${edge.ord})`,
      // );
      fmtSignal(dep, indent + 2);
    }

    // ── subs (who consumes this signal) ──
    // const subs: Map<any, any> = sig.subs;
    // line(indent, `  subs (${subs.size}):`);
    // for (const [ref] of subs) {
    //   const sub = ref.deref?.();
    //   const subDesc = sub?.def?.desc ?? sub?.id ?? '(gc)';
    //   line(indent, `    <- ${subDesc}`);
    // }
  }

  // ── entry point: navigate from ReactivePromise → its backing ReactiveSignal ──
  let rootSignal: any;
  if (promiseOrSignal != null && typeof promiseOrSignal === 'object' && '_awaitSubs' in promiseOrSignal) {
    rootSignal = promiseOrSignal['_signal'];
    if (!rootSignal) {
      lines.push('(ReactivePromise has no backing _signal)');
    }
  } else {
    rootSignal = promiseOrSignal;
  }

  if (rootSignal) {
    fmtSignal(rootSignal, 0);
  }

  // ── optional: state signals (from signal()) ──
  // if (stateSignals) {
  //   lines.push('');
  //   for (const [name, ss] of Object.entries(stateSignals)) {
  //     line(0, `[StateSignal: ${name}]  (desc=${ss['_desc']}, id=${ss['_id']})`);
  //     line(0, `  value: ${JSON.stringify(ss['_value'])}`);
  //     const subs: Map<any, any> = ss['_subs'];
  //     line(0, `  subs (${subs.size}):`);
  //     for (const [ref, consumedAt] of subs) {
  //       const sig = ref.deref?.();
  //       const desc = sig?.def?.desc ?? sig?.id ?? '(gc)';
  //       line(0, `    <- ${desc}  (consumedAt=${consumedAt})`);
  //     }
  //   }
  // }

  const header = label ? `\n━━━ ${label} ━━━` : '\n━━━ Signal Tree ━━━';
  console.log(header + '\n' + lines.join('\n') + '\n');
}

// ─── Tests ───

describe('reactive async immediate read after sequential writes', () => {
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
      expect(items).toContain('cat');
      expect(items).toContain('dog');

      // 3) third write — this has been observed to intermittently fail
      write('fish');
      items = await getOutermost();
      expect(items).toContain('cat');
      expect(items).toContain('dog');
      expect(items).toContain('fish');
    },
  );
});
