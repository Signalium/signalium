'use client';

import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';

// =============================================================================
// CascadeSection — animated SVG comparison of React's full re-render walk
// versus Signalium's focused dirty-cascade.
// =============================================================================
//
// Two side-by-side graphs share the same shape: a fan of state signals (s0..s6)
// → reactives (r0..r4) → derived (d0..d3) → effects (e0..e1) → component (c).
// On each scenario we pick one signal to mutate; the LEFT side animates a
// React-style depth-first walk that visits every node, the RIGHT side animates
// only the dependency path that actually changed, with cutoff markers when a
// reactive returned the same value.
//
// The state graph is intentionally hand-tuned (not a simulation of the real
// runtime) so each scenario tells a clean visual story.
// =============================================================================

const REACTIVES: Record<string, string[]> = {
  r0: ['s0', 's1'],
  r1: ['s1', 's2'],
  r2: ['s2', 's3', 's4'],
  r3: ['s4', 's5'],
  r4: ['s5', 's6'],
};
const DERIVED: Record<string, string[]> = {
  d0: ['r0', 'r1'],
  d1: ['r1', 'r2'],
  d2: ['r2', 'r3'],
  d3: ['r3', 'r4'],
};
const FINAL: Record<string, string[]> = {
  e0: ['d0', 'd1', 'd2'],
  e1: ['d1', 'd2', 'd3'],
};
const ALL_R = ['r0', 'r1', 'r2', 'r3', 'r4'];
const ALL_D = ['d0', 'd1', 'd2', 'd3'];
const ALL_E = ['e0', 'e1'];

type ReactVisit = {
  node: string;
  parentEdge: string | null;
  crossEdges: string[];
};

const REACT_VISITS: ReactVisit[] = [
  { node: 'c', parentEdge: null, crossEdges: [] },
  { node: 'e0', parentEdge: 'e0-c', crossEdges: [] },
  { node: 'd0', parentEdge: 'd0-e0', crossEdges: [] },
  { node: 'r0', parentEdge: 'r0-d0', crossEdges: [] },
  { node: 's0', parentEdge: 's0-r0', crossEdges: [] },
  { node: 's1', parentEdge: 's1-r0', crossEdges: [] },
  { node: 'r1', parentEdge: 'r1-d0', crossEdges: ['s1-r1'] },
  { node: 's2', parentEdge: 's2-r1', crossEdges: [] },
  { node: 'd1', parentEdge: 'd1-e0', crossEdges: ['r1-d1'] },
  { node: 'r2', parentEdge: 'r2-d1', crossEdges: ['s2-r2'] },
  { node: 's3', parentEdge: 's3-r2', crossEdges: [] },
  { node: 's4', parentEdge: 's4-r2', crossEdges: [] },
  { node: 'd2', parentEdge: 'd2-e0', crossEdges: ['r2-d2'] },
  { node: 'r3', parentEdge: 'r3-d2', crossEdges: ['s4-r3'] },
  { node: 's5', parentEdge: 's5-r3', crossEdges: [] },
  { node: 'e1', parentEdge: 'e1-c', crossEdges: ['d1-e1', 'd2-e1'] },
  { node: 'd3', parentEdge: 'd3-e1', crossEdges: ['r3-d3'] },
  { node: 'r4', parentEdge: 'r4-d3', crossEdges: ['s5-r4'] },
  { node: 's6', parentEdge: 's6-r4', crossEdges: [] },
];

type Scenario = { signal: string; cutoffs: string[] };

const SCENARIOS: Scenario[] = [
  { signal: 's0', cutoffs: ['r0'] },
  { signal: 's3', cutoffs: ['d1', 'd2'] },
  { signal: 's5', cutoffs: [] },
  { signal: 's6', cutoffs: ['e1'] },
  { signal: 's2', cutoffs: ['r1'] },
];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function computeReactReran(signalId: string): Set<string> {
  const reran = new Set<string>([signalId]);
  for (const [r, deps] of Object.entries(REACTIVES))
    if (deps.includes(signalId)) reran.add(r);
  for (const [d, deps] of Object.entries(DERIVED))
    if (deps.some((r) => reran.has(r))) reran.add(d);
  for (const [e, deps] of Object.entries(FINAL))
    if (deps.some((d) => reran.has(d))) reran.add(e);
  reran.add('c');
  return reran;
}

function computeReactActiveEdges(
  signalId: string,
  reran: Set<string>,
): Set<string> {
  const edges = new Set<string>();
  for (const [r, deps] of Object.entries(REACTIVES))
    if (reran.has(r))
      for (const s of deps) if (s === signalId) edges.add(`${s}-${r}`);
  for (const [d, deps] of Object.entries(DERIVED))
    if (reran.has(d))
      for (const r of deps) if (reran.has(r)) edges.add(`${r}-${d}`);
  for (const [e, deps] of Object.entries(FINAL))
    if (reran.has(e))
      for (const d of deps) if (reran.has(d)) edges.add(`${d}-${e}`);
  for (const e of ALL_E) if (reran.has(e)) edges.add(`${e}-c`);
  return edges;
}

type SignaliumResult = {
  active: Set<string>;
  cutoff: Set<string>;
  activeEdges: Set<string>;
  cutoffEdges: Set<string>;
};

function computeSignalium(
  signalId: string,
  manualCutoffs: string[],
): SignaliumResult {
  const active = new Set<string>([signalId]);
  const cutoff = new Set<string>();
  const activeEdges = new Set<string>();
  const cutoffEdges = new Set<string>();
  const cutSet = new Set(manualCutoffs);
  for (const [r, deps] of Object.entries(REACTIVES)) {
    if (deps.includes(signalId)) {
      active.add(r);
      activeEdges.add(`${signalId}-${r}`);
      if (cutSet.has(r)) cutoff.add(r);
    }
  }
  for (const [d, deps] of Object.entries(DERIVED)) {
    const prop = deps.filter((x) => active.has(x) && !cutoff.has(x));
    const cut = deps.filter((x) => active.has(x) && cutoff.has(x));
    if (prop.length > 0) {
      active.add(d);
      prop.forEach((x) => activeEdges.add(`${x}-${d}`));
      cut.forEach((x) => cutoffEdges.add(`${x}-${d}`));
      if (cutSet.has(d)) cutoff.add(d);
    } else cut.forEach((x) => cutoffEdges.add(`${x}-${d}`));
  }
  for (const [e, deps] of Object.entries(FINAL)) {
    const prop = deps.filter((x) => active.has(x) && !cutoff.has(x));
    const cut = deps.filter((x) => active.has(x) && cutoff.has(x));
    if (prop.length > 0) {
      active.add(e);
      prop.forEach((x) => activeEdges.add(`${x}-${e}`));
      cut.forEach((x) => cutoffEdges.add(`${x}-${e}`));
      if (cutSet.has(e)) cutoff.add(e);
    } else cut.forEach((x) => cutoffEdges.add(`${x}-${e}`));
  }
  const propE = ALL_E.filter((e) => active.has(e) && !cutoff.has(e));
  const cutE = ALL_E.filter((e) => active.has(e) && cutoff.has(e));
  if (propE.length > 0) {
    active.add('c');
    propE.forEach((e) => activeEdges.add(`${e}-c`));
  }
  cutE.forEach((e) => cutoffEdges.add(`${e}-c`));
  return { active, cutoff, activeEdges, cutoffEdges };
}

// ---------------------------------------------------------------------------
// Layout — every node lives at a fixed position so the SVG stays declarative.
// ---------------------------------------------------------------------------

type Side = 'left' | 'right';

const POSITIONS: Record<
  Side,
  Record<string, { x: number }[] | { x: number }>
> = {
  left: {
    s: [
      { x: 40 },
      { x: 80 },
      { x: 120 },
      { x: 160 },
      { x: 200 },
      { x: 240 },
      { x: 280 },
    ],
    r: [{ x: 40 }, { x: 100 }, { x: 160 }, { x: 220 }, { x: 280 }],
    d: [{ x: 70 }, { x: 130 }, { x: 190 }, { x: 250 }],
    e: [{ x: 110 }, { x: 210 }],
    c: { x: 160 },
  },
  right: {
    s: [
      { x: 400 },
      { x: 440 },
      { x: 480 },
      { x: 520 },
      { x: 560 },
      { x: 600 },
      { x: 640 },
    ],
    r: [{ x: 400 }, { x: 460 }, { x: 520 }, { x: 580 }, { x: 640 }],
    d: [{ x: 430 }, { x: 490 }, { x: 550 }, { x: 610 }],
    e: [{ x: 470 }, { x: 570 }],
    c: { x: 520 },
  },
};

const Y: Record<string, number> = { s: 20, r: 80, d: 150, e: 225, c: 315 };

const EDGE_DEFS: [string, string][] = [
  ['s0', 'r0'],
  ['s1', 'r0'],
  ['s1', 'r1'],
  ['s2', 'r1'],
  ['s2', 'r2'],
  ['s3', 'r2'],
  ['s4', 'r2'],
  ['s4', 'r3'],
  ['s5', 'r3'],
  ['s5', 'r4'],
  ['s6', 'r4'],
  ['r0', 'd0'],
  ['r1', 'd0'],
  ['r1', 'd1'],
  ['r2', 'd1'],
  ['r2', 'd2'],
  ['r3', 'd2'],
  ['r3', 'd3'],
  ['r4', 'd3'],
  ['d0', 'e0'],
  ['d1', 'e0'],
  ['d2', 'e0'],
  ['d1', 'e1'],
  ['d2', 'e1'],
  ['d3', 'e1'],
  ['e0', 'c'],
  ['e1', 'c'],
];

function nodeXY(side: Side, id: string) {
  const layer = id[0];
  const idx = id.length > 1 ? parseInt(id.slice(1), 10) : 0;
  const pos = POSITIONS[side];
  const x =
    layer === 'c'
      ? (pos.c as { x: number }).x
      : (pos[layer] as { x: number }[])[idx].x;
  return { x, y: Y[layer] };
}

function CascadeEdges({ side }: { side: Side }) {
  return (
    <>
      {EDGE_DEFS.map(([from, to]) => {
        const a = nodeXY(side, from);
        const b = nodeXY(side, to);
        return (
          <line
            key={`${from}-${to}`}
            id={`${side}-${from}-${to}`}
            className="edge-line"
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
          />
        );
      })}
    </>
  );
}

function CascadeNodes({ side }: { side: Side }) {
  const radii: Record<string, number> = { s: 3, r: 6, d: 10, e: 15, c: 22 };
  const all: { id: string; layer: string }[] = [];
  (['s', 'r', 'd', 'e'] as const).forEach((layer) => {
    (POSITIONS[side][layer] as { x: number }[]).forEach((_, i) =>
      all.push({ id: `${layer}${i}`, layer }),
    );
  });
  all.push({ id: 'c', layer: 'c' });
  return (
    <>
      {all.map(({ id, layer }) => {
        const { x, y } = nodeXY(side, id);
        return (
          <circle
            key={id}
            id={`${side}-${id}`}
            className="node-circle"
            cx={x}
            cy={y}
            r={radii[layer]}
          />
        );
      })}
    </>
  );
}

function Legend({
  color,
  label,
  opacity = 1,
}: {
  color: string;
  label: string;
  opacity?: number;
}) {
  return (
    <div className="flex items-center gap-1.5 text-primary-300">
      <span
        className="inline-block h-2.5 w-2.5 rounded-full"
        style={{ background: color, opacity }}
      />
      {label}
    </div>
  );
}

function CascadeViz() {
  const [reactCount, setReactCount] = useState(0);
  const [sigCount, setSigCount] = useState(0);
  const [reactTick, setReactTick] = useState(false);
  const [sigTick, setSigTick] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const stopRef = useRef(false);

  useEffect(() => {
    stopRef.current = false;
    const setCls = (side: Side, id: string, cls: string) => {
      const el = svgRef.current?.querySelector<SVGElement>(`#${side}-${id}`);
      if (el) {
        el.classList.remove(cls);
        // force reflow so the animation restarts
        void (el as unknown as HTMLElement).offsetWidth;
        el.classList.add(cls);
      }
    };
    const clearAll = () => {
      svgRef.current
        ?.querySelectorAll('.node-circle, .edge-line')
        .forEach((el) => el.classList.remove('active', 'cutoff', 'visited'));
    };
    const tickReact = () => {
      setReactCount((c) => c + 1);
      setReactTick(true);
      setTimeout(() => setReactTick(false), 380);
    };
    const tickSig = () => {
      setSigCount((c) => c + 1);
      setSigTick(true);
      setTimeout(() => setSigTick(false), 380);
    };

    async function animateReactDFS(
      reactReran: Set<string>,
      reactActiveEdges: Set<string>,
      signalId: string,
    ) {
      tickReact();
      for (const v of REACT_VISITS) {
        if (stopRef.current) return;
        if (v.parentEdge)
          setCls(
            'left',
            v.parentEdge,
            reactActiveEdges.has(v.parentEdge) ? 'active' : 'visited',
          );
        for (const ce of v.crossEdges)
          setCls('left', ce, reactActiveEdges.has(ce) ? 'active' : 'visited');
        if (v.node !== signalId)
          setCls('left', v.node, reactReran.has(v.node) ? 'active' : 'visited');
        await sleep(115);
      }
    }

    async function animateSignalium(sc: Scenario, sigResult: SignaliumResult) {
      ALL_R.forEach((r) => {
        if (sigResult.active.has(r)) {
          setCls('right', r, sigResult.cutoff.has(r) ? 'cutoff' : 'active');
          setCls('right', `${sc.signal}-${r}`, 'active');
        }
      });
      await sleep(420);
      if (stopRef.current) return;
      ALL_D.forEach((d) => {
        if (sigResult.active.has(d))
          setCls('right', d, sigResult.cutoff.has(d) ? 'cutoff' : 'active');
      });
      sigResult.activeEdges.forEach((e) => {
        if (/^r\d-d/.test(e)) setCls('right', e, 'active');
      });
      sigResult.cutoffEdges.forEach((e) => {
        if (/^r\d-d/.test(e)) setCls('right', e, 'cutoff');
      });
      await sleep(420);
      if (stopRef.current) return;
      ALL_E.forEach((e) => {
        if (sigResult.active.has(e))
          setCls('right', e, sigResult.cutoff.has(e) ? 'cutoff' : 'active');
      });
      sigResult.activeEdges.forEach((e) => {
        if (/^d\d-e/.test(e)) setCls('right', e, 'active');
      });
      sigResult.cutoffEdges.forEach((e) => {
        if (/^d\d-e/.test(e)) setCls('right', e, 'cutoff');
      });
      await sleep(420);
      if (stopRef.current) return;
      if (sigResult.active.has('c')) {
        setCls('right', 'c', 'active');
        tickSig();
      }
      sigResult.activeEdges.forEach((e) => {
        if (e.endsWith('-c')) setCls('right', e, 'active');
      });
      sigResult.cutoffEdges.forEach((e) => {
        if (e.endsWith('-c')) setCls('right', e, 'cutoff');
      });
    }

    async function runScenario(idx: number) {
      clearAll();
      await sleep(220);
      if (stopRef.current) return;
      const sc = SCENARIOS[idx];
      const reactReran = computeReactReran(sc.signal);
      const reactActiveEdges = computeReactActiveEdges(sc.signal, reactReran);
      const sigResult = computeSignalium(sc.signal, sc.cutoffs);
      setCls('left', sc.signal, 'active');
      setCls('right', sc.signal, 'active');
      await sleep(420);
      if (stopRef.current) return;
      await Promise.all([
        animateReactDFS(reactReran, reactActiveEdges, sc.signal),
        animateSignalium(sc, sigResult),
      ]);
      await sleep(1700);
    }

    async function loop() {
      let idx = 0;
      while (!stopRef.current) {
        await runScenario(idx);
        if (stopRef.current) break;
        await sleep(700);
        idx = (idx + 1) % SCENARIOS.length;
      }
    }

    const startTimer = setTimeout(loop, 700);
    return () => {
      stopRef.current = true;
      clearTimeout(startTimer);
    };
  }, []);

  return (
    <div>
      <style>{`
        .node-circle { fill: var(--color-primary-500); opacity: 0.3; transition: fill 0.6s ease, opacity 0.6s ease; }
        .node-circle.visited { fill: var(--color-primary-100); opacity: 0.5; animation: nodeFlash 0.55s ease-out; }
        .node-circle.active { fill: var(--color-tertiary-400); opacity: 1; }
        .node-circle.cutoff { fill: var(--color-secondary-300); opacity: 1; }
        .edge-line { stroke: var(--color-primary-500); stroke-width: 0.5; opacity: 0.15; transition: stroke 0.6s ease, stroke-width 0.6s ease, opacity 0.6s ease, stroke-dasharray 0.6s ease; }
        .edge-line.visited { stroke: var(--color-primary-200); opacity: 0.4; stroke-width: 0.8; animation: edgeFlash 0.55s ease-out; }
        .edge-line.active { stroke: var(--color-tertiary-400); stroke-width: 1.5; opacity: 0.95; }
        .edge-line.cutoff { stroke: var(--color-secondary-300); stroke-width: 1.5; stroke-dasharray: 4 4; opacity: 0.9; }
        @keyframes nodeFlash { 0% { fill: var(--color-primary-500); opacity: 0.3; } 30% { fill: var(--color-primary-50); opacity: 0.95; } 100% { fill: var(--color-primary-100); opacity: 0.5; } }
        @keyframes edgeFlash { 0% { opacity: 0.15; stroke-width: 0.5; } 30% { opacity: 0.85; stroke-width: 1.3; } 100% { opacity: 0.4; stroke-width: 0.8; } }
        @media (prefers-reduced-motion: reduce) { .node-circle, .edge-line { transition: none; animation: none; } }
      `}</style>

      <div className="mb-3 grid grid-cols-2 gap-x-10 px-2 py-4 text-center">
        <div>
          <div className="mb-2 font-mono text-[10px] tracking-[0.18em] text-primary-400">
            REACT RE-RENDERS
          </div>
          <div
            className={clsx(
              'font-mono text-4xl font-medium tabular-nums transition-all duration-300',
              reactTick ? 'scale-110 text-primary-50' : 'text-primary-100',
            )}
          >
            {reactCount}
          </div>
        </div>
        <div>
          <div className="mb-2 font-mono text-[10px] tracking-[0.18em] text-tertiary-300">
            SIGNALIUM RE-RENDERS
          </div>
          <div
            className={clsx(
              'font-mono text-4xl font-medium tabular-nums transition-all duration-300',
              sigTick ? 'scale-110 text-tertiary-300' : 'text-primary-100',
            )}
          >
            {sigCount}
          </div>
        </div>
      </div>

      <div className="mb-3 text-center text-[11px] text-primary-400 italic">
        left walks the whole tree every render · right only follows the change
      </div>

      <svg
        ref={svgRef}
        viewBox="0 0 680 360"
        className="w-full"
        role="img"
        aria-label="Animated comparison of React's full tree walk versus Signalium's focused cascade"
      >
        <line
          x1="340"
          y1="10"
          x2="340"
          y2="350"
          stroke="var(--color-primary-700)"
          strokeWidth="0.5"
          strokeDasharray="2 4"
        />
        <CascadeEdges side="left" />
        <CascadeEdges side="right" />
        <CascadeNodes side="left" />
        <CascadeNodes side="right" />
      </svg>

      <div className="mt-4 flex flex-wrap justify-center gap-4 border-t border-primary-800 pt-3 text-[11px]">
        <Legend color="var(--color-tertiary-400)" label="recomputed" />
        <Legend
          color="var(--color-primary-100)"
          label="checked, returned cache"
          opacity={0.65}
        />
        <Legend
          color="var(--color-secondary-300)"
          label="ran, same value (halts)"
        />
        <Legend
          color="var(--color-primary-500)"
          label="never touched"
          opacity={0.4}
        />
      </div>
    </div>
  );
}

export { CascadeViz };
