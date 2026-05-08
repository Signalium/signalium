'use client';

import clsx from 'clsx';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { CascadeViz } from './CascadeSection';
import {
  CATEGORY_STYLES,
  CTAButton,
  CodeBlock,
  Element,
  InstallCommand,
  Section,
  type Category,
} from './shared';

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

const HERO_CODE = `export const UserCard = component(async (userId) => {
  const user = await fetchUser(userId.value);
  const posts = await fetchPosts(user.blogId);

  return (
    <div>
      <h2>{user.name}</h2>
      <PostList posts={posts} />
    </div>
  );
});
`;

function ElementStrip() {
  return (
    <div className="flex items-center justify-center gap-2 pb-16 md:gap-4">
      <Element num={15} sym="Cm" name="computed" category="muted" size="md" />
      <Element num={16} sym="Rl" name="relay" category="muted" size="md" />
      <div className="-mb-1">
        <Element
          num={14}
          sym="Sg"
          name="signalium"
          category="focal"
          size="lg"
        />
      </div>
      <Element num={17} sym="Aa" name="async" category="muted" size="md" />
      <Element num={18} sym="Rx" name="reactive" category="muted" size="md" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Model cards
// ---------------------------------------------------------------------------

const MODEL_CARDS: { oldName: string; newName: string; body: string }[] = [
  {
    oldName: 'useMemo + dependency arrays',
    newName: 'Reactive functions',
    body: 'Already memoized. Dependencies tracked by what the function actually reads.',
  },
  {
    oldName: 'useEffect + cleanup',
    newName: 'Relays',
    body: 'Structured, composable effect management. Setup and teardown co-located.',
  },
  {
    oldName: 'use / Suspense wiring',
    newName: 'async / await',
    body: 'Write normal async code. Dependencies tracked through await boundaries.',
  },
  {
    oldName: 'Rules of Hooks',
    newName: 'No rules',
    body: 'Call reactive functions in branches, loops, callbacks — wherever your logic goes.',
  },
];

function ModelCard({
  oldName,
  newName,
  body,
}: {
  oldName: string;
  newName: string;
  body: string;
}) {
  return (
    <div className="rounded-lg border border-primary-800 bg-primary-900 p-5">
      <div className="mb-2 font-mono text-sm text-primary-500 line-through decoration-primary-600">
        {oldName}
      </div>
      <h3 className="mb-2 font-sans text-lg font-semibold text-primary-50">
        {newName}
      </h3>
      <p className="font-sans text-sm leading-relaxed text-primary-300">
        {body}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// "Stop writing" cards
// ---------------------------------------------------------------------------

const STRIKETHROUGHS: { name: string; reason: string }[] = [
  {
    name: 'useEffect',
    reason: 'Reactivity is the default. Side effects subscribe automatically.',
  },
  {
    name: 'useMemo',
    reason: 'Every reactive is memoized. Cached until a dep actually changes.',
  },
  {
    name: 'useCallback',
    reason: 'Function identity is stable by construction. No wrapper needed.',
  },
  {
    name: 'dep arrays',
    reason: 'Deps tracked at read time. Nothing to declare, nothing to forget.',
  },
  {
    name: 'cleanup flags',
    reason:
      'Stale-response and race-condition checks are handled by the runtime.',
  },
  {
    name: 'query keys',
    reason:
      'Cache identity is the call site plus its arguments. Zero ceremony.',
  },
];

function StrikethroughCard({
  name,
  reason,
}: {
  name: string;
  reason: string;
}) {
  return (
    <div className="rounded-md border border-primary-800 bg-primary-900 p-4">
      <div className="mb-1.5 font-mono text-sm text-primary-400 line-through decoration-primary-600">
        {name}
      </div>
      <p className="text-[13px] leading-relaxed text-primary-300">{reason}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Runtime examples
// ---------------------------------------------------------------------------

const RUNTIME_EXAMPLES: { tag: string; filename: string; code: string }[] = [
  {
    tag: 'react',
    filename: 'Profile.tsx',
    code: `import { component } from 'signalium/react';

const Profile = component(async ({ id }) => {
  const user = await fetchUser(id);
  return <h1>{user.name}</h1>;
});`,
  },
  {
    tag: 'node.js',
    filename: 'stats.ts',
    code: `import { reactive } from 'signalium';

const stats = reactive(async () => {
  const data = await fetchMetrics();
  return summarize(data);
});

console.log(await stats());`,
  },
  {
    tag: 'vanilla dom',
    filename: 'clock.ts',
    code: `import { reactive, effect } from 'signalium';

const time = reactive(() =>
  new Date().toLocaleTimeString()
);

effect(() => {
  clock.textContent = time();
});`,
  },
  {
    tag: 'web worker',
    filename: 'worker.ts',
    code: `import { reactive } from 'signalium';

const heavy = reactive(async (input) => {
  return await crunch(input);
});

self.onmessage = (e) => {
  self.postMessage(heavy(e.data));
};`,
  },
];

function RuntimeCard({
  tag,
  filename,
  code,
}: {
  tag: string;
  filename: string;
  code: string;
}) {
  return (
    <div>
      <div className="mb-2 font-mono text-[10px] tracking-[0.18em] text-primary-400">
        {tag.toUpperCase()}
      </div>
      <CodeBlock filename={filename} lang="ts" code={code} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comparison table
// ---------------------------------------------------------------------------

const COMPARISON_ROWS: [string, string, string, string][] = [
  ['Async components', 'First class', '—', 'Server only'],
  ['Fine-grained reactivity', '✓', '—', '—'],
  ['Auto-tracked deps', '✓', '—', '—'],
  ['Cutoff propagation', '✓', '—', '—'],
  ['Server + client parity', 'Same code', 'Same code', 'Different code'],
  ['Works outside React', '✓', '—', '—'],
  ['Suspense compatible', '✓', '✓', '✓'],
  ['Hand-written deps', 'Never', 'Sometimes', 'Always'],
];

function ComparisonCell({
  children,
  accent = false,
  muted = false,
}: {
  children: ReactNode;
  accent?: boolean;
  muted?: boolean;
}) {
  return (
    <td
      className={clsx(
        'px-4 py-3 text-sm',
        accent && 'font-medium text-tertiary-200',
        muted && 'text-primary-500',
        !accent && !muted && 'text-primary-200',
      )}
    >
      {children}
    </td>
  );
}

// ---------------------------------------------------------------------------
// Footer links
// ---------------------------------------------------------------------------

type FooterLinkEntry = {
  num: string;
  sym: string;
  name: string;
  category: Exclude<Category, 'focal'>;
  href: string;
};

const FOOTER_LINKS: FooterLinkEntry[] = [
  { num: '1', sym: 'Si', name: 'Signals', category: 'core', href: '/signals' },
  {
    num: '2',
    sym: 'Rv',
    name: 'Reactives',
    category: 'core',
    href: '/reactives',
  },
  {
    num: '3',
    sym: 'Cm',
    name: 'Components',
    category: 'core',
    href: '/components/first-component',
  },
  {
    num: '11',
    sym: 'Rt',
    name: 'React',
    category: 'runtime',
    href: '/api/signalium-react',
  },
];

function FooterLink({ num, sym, name, category, href }: FooterLinkEntry) {
  const c = CATEGORY_STYLES[category];
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-md border border-primary-800 bg-primary-900 px-3 py-2.5 transition-colors hover:border-primary-700"
    >
      <div
        className={clsx(
          'flex h-8 w-8 shrink-0 flex-col justify-between rounded border p-1 font-mono',
          c.bg,
          c.border,
        )}
      >
        <span className={clsx('text-[7px]', c.num)}>{num}</span>
        <span className={clsx('text-xs leading-none font-medium', c.text)}>
          {sym}
        </span>
      </div>
      <span className="font-mono text-sm text-primary-200 group-hover:text-primary-50">
        {name}
      </span>
    </Link>
  );
}

function InlineCode({ children }: { children: ReactNode }) {
  return (
    <code className="font-mono text-[0.95em] text-primary-100">{children}</code>
  );
}

// =============================================================================
// SignaliumHome
// =============================================================================

export function SignaliumHome() {
  return (
    <div className="w-full bg-primary-950 text-primary-50 antialiased">
      <div className="mx-auto max-w-6xl px-6">
        {/* ---- Hero ---- */}
        <section className="flex min-h-screen flex-col justify-center px-16 pb-48">
          <div>
            <ElementStrip />
          </div>
          <div className="grid grid-cols-1 items-center gap-10 md:grid-cols-2 md:gap-12">
            <div>
              <h1 className="mb-6 font-sans text-4xl leading-[1.1] font-semibold tracking-tight text-primary-50 md:text-5xl">
                What if components were{' '}
                <span className="text-amber-400">just functions</span>?
              </h1>
              <p className="mb-4 font-sans text-base leading-relaxed text-primary-200">
                Not functions with seventeen rules about ordering and
                dependencies. Not functions that need a magical compiler to
                perform well. Just functions — where reactivity is the execution
                model and everything else follows.
              </p>
              <p className="mb-10 font-sans text-base leading-relaxed text-primary-200">
                Signalium. React, made simple.
              </p>
              <div className="flex flex-wrap gap-3">
                <CTAButton variant="primary" href="/quickstart">
                  Get started in 5 minutes
                </CTAButton>
                <CTAButton
                  variant="secondary"
                  href="https://github.com/Signalium/signalium"
                  external
                >
                  GitHub
                </CTAButton>
              </div>
            </div>
            <div>
              <CodeBlock code={HERO_CODE} compact />
            </div>
          </div>
        </section>

        {/* ---- Problem ---- */}
        <Section className="border-t border-primary-800">
          <h2 className="mb-6 font-sans text-2xl font-semibold tracking-tight text-primary-50 md:text-3xl">
            Remember when Hooks felt like magic?
          </h2>
          <div className="space-y-4">
            <p className="font-sans text-base leading-relaxed text-primary-300">
              You&apos;ve wrapped a value in <InlineCode>useMemo</InlineCode>{' '}
              and added a dependency array you&apos;ll forget to update.
              You&apos;ve written a <InlineCode>useEffect</InlineCode> that runs
              when it shouldn&apos;t. You&apos;ve restructured your logic around
              your framework instead of your problem.
            </p>
            <p className="font-sans text-base leading-relaxed text-primary-300">
              The React Compiler is trying to fix this. Signalium asks:{' '}
              <strong className="font-semibold text-primary-50">
                what if the model didn&apos;t need fixing?
              </strong>
            </p>
          </div>
        </Section>

        {/* ---- Model ---- */}
        <Section className="border-t border-primary-800">
          <h2 className="mb-3 font-sans text-2xl font-semibold tracking-tight text-primary-50 md:text-3xl">
            Reactivity as the execution model
          </h2>
          <p className="mb-2 font-sans text-base leading-relaxed text-primary-300">
            Reactive functions don&apos;t re-run top to bottom. They re-execute
            only the parts that depend on what changed — real incremental
            computation.
          </p>
          <p className="mb-8 font-sans text-base leading-relaxed text-primary-300">
            That one idea eliminates most of what makes Hooks hard:
          </p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {MODEL_CARDS.map((c) => (
              <ModelCard key={c.newName} {...c} />
            ))}
          </div>
        </Section>

        {/* ---- Cascade ---- */}
        <Section
          eyebrow="Fine-grained re-execution"
          title="Hooks rerun every node."
          accent="Signalium runs what changed."
        >
          <div className="rounded-lg border border-primary-800 bg-primary-900 p-5">
            <CascadeViz />
          </div>
        </Section>

        {/* ---- Stop writing ---- */}
        <Section
          eyebrow="Your hooks file gets a lot shorter"
          title="Things you"
          accent="stop writing."
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {STRIKETHROUGHS.map((s) => (
              <StrikethroughCard key={s.name} {...s} />
            ))}
          </div>
        </Section>

        {/* ---- Runtimes ---- */}
        <Section
          eyebrow="One primitive, four runtimes"
          title="React or anywhere."
          accent="Same primitive."
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {RUNTIME_EXAMPLES.map((e) => (
              <RuntimeCard key={e.tag} {...e} />
            ))}
          </div>
        </Section>

        {/* ---- Comparison ---- */}
        <Section
          eyebrow="What you get"
          title="The reactive part of"
          accent="every modern stack."
        >
          <div className="overflow-x-auto rounded-lg border border-primary-800">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-primary-800 bg-primary-900">
                  <th className="px-4 py-3 font-mono text-[11px] font-medium tracking-[0.12em] text-primary-400" />
                  <th className="px-4 py-3 font-mono text-[11px] font-medium tracking-[0.12em] text-tertiary-200">
                    SIGNALIUM
                  </th>
                  <th className="px-4 py-3 font-mono text-[11px] font-medium tracking-[0.12em] text-primary-300">
                    REACT HOOKS
                  </th>
                  <th className="px-4 py-3 font-mono text-[11px] font-medium tracking-[0.12em] text-primary-300">
                    REACT SERVER
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON_ROWS.map(([label, sig, hooks, server], i) => (
                  <tr
                    key={i}
                    className="border-b border-primary-800/30 last:border-0"
                  >
                    <td className="px-4 py-3 text-sm text-primary-300">
                      {label}
                    </td>
                    <ComparisonCell accent>{sig}</ComparisonCell>
                    <ComparisonCell muted={hooks === '—'}>
                      {hooks}
                    </ComparisonCell>
                    <ComparisonCell muted={server === '—'}>
                      {server}
                    </ComparisonCell>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {/* ---- Final CTA ---- */}
        <Section className="text-center">
          <h2 className="mb-4 font-mono text-3xl text-primary-50">
            Start being reactive.
          </h2>
          <p className="mx-auto mb-8 max-w-md text-primary-300">
            Add Signalium to your project and rewrite one component in five
            minutes.
          </p>
          <div className="mb-12 flex flex-wrap items-center justify-center gap-3">
            <InstallCommand />
            <CTAButton variant="primary" href="/quickstart" arrow>
              Read the docs
            </CTAButton>
            <CTAButton
              variant="secondary"
              href="https://github.com/Signalium/signalium"
              external
            >
              GitHub →
            </CTAButton>
          </div>
          <div className="mx-auto grid max-w-2xl grid-cols-2 gap-3 md:grid-cols-4">
            {FOOTER_LINKS.map((l) => (
              <FooterLink key={l.sym} {...l} />
            ))}
          </div>
        </Section>

        {/* ---- Footer ---- */}
        <footer className="flex items-center justify-between border-t border-primary-800 py-8 font-mono text-xs text-primary-400">
          <div className="flex items-center gap-3">
            <span className="text-primary-100">signalium</span>
            <span>—</span>
            <span>The reactive element</span>
          </div>
          <div className="flex gap-5 [&_a]:transition-colors [&_a:hover]:text-primary-100">
            <Link href="https://github.com/Signalium/signalium">GitHub</Link>
            <Link href="https://www.npmjs.com/package/signalium">npm</Link>
            <Link href="https://discord.gg/signalium">Discord</Link>
          </div>
        </footer>
      </div>
    </div>
  );
}
