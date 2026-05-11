import clsx from 'clsx';
import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
import { Highlight, type PrismTheme } from 'prism-react-renderer';

// =============================================================================
// Shared home-page building blocks
// =============================================================================
// The home page is laid out as a "periodic table of reactive elements" — each
// primitive is rendered as an atomic tile (atomic number + symbol + name),
// color-coded by category. The same element shape is reused throughout the
// page (hero table, feature cards, footer links).
//
// Brand palette:
//   tertiary-* — purple (the brand / core primitives)
//   secondary-* — yellow (async + accent)
// Auxiliary colors used for category differentiation:
//   sky-*  — tracking
//   pink-* — runtimes
// =============================================================================

// ---------------------------------------------------------------------------
// Category style tokens
// ---------------------------------------------------------------------------

export type Category =
  | 'core'
  | 'async'
  | 'tracking'
  | 'runtime'
  | 'focal'
  | 'muted';

type CategoryStyle = {
  bg: string;
  border: string;
  hoverBorder: string;
  text: string;
  num: string;
  label: string;
  name: string;
};

export const CATEGORY_STYLES: Record<Category, CategoryStyle> = {
  core: {
    bg: 'bg-tertiary-950/50',
    border: 'border-tertiary-800/60',
    hoverBorder: 'hover:border-tertiary-600/80',
    text: 'text-tertiary-200',
    num: 'text-tertiary-300/70',
    label: 'text-tertiary-300',
    name: 'text-tertiary-300/70',
  },
  async: {
    bg: 'bg-secondary-950/50',
    border: 'border-secondary-800/60',
    hoverBorder: 'hover:border-secondary-600/80',
    text: 'text-secondary-200',
    num: 'text-secondary-300/70',
    label: 'text-secondary-300',
    name: 'text-secondary-300/70',
  },
  tracking: {
    bg: 'bg-sky-950/40',
    border: 'border-sky-800/60',
    hoverBorder: 'hover:border-sky-600/80',
    text: 'text-sky-200',
    num: 'text-sky-400/70',
    label: 'text-sky-400',
    name: 'text-sky-400/70',
  },
  runtime: {
    bg: 'bg-pink-950/40',
    border: 'border-pink-800/60',
    hoverBorder: 'hover:border-pink-600/80',
    text: 'text-pink-200',
    num: 'text-pink-400/70',
    label: 'text-pink-400',
    name: 'text-pink-400/70',
  },
  focal: {
    bg: 'bg-tertiary-300/15',
    border: 'border-tertiary-300/80',
    hoverBorder: 'hover:border-tertiary-200',
    text: 'text-tertiary-100',
    num: 'text-tertiary-200',
    label: 'text-tertiary-200',
    name: 'text-tertiary-200/80',
  },
  muted: {
    bg: 'bg-primary-900',
    border: 'border-primary-800',
    hoverBorder: 'hover:border-primary-700',
    text: 'text-primary-400',
    num: 'text-primary-500',
    label: 'text-primary-500',
    name: 'text-primary-500',
  },
};

const CATEGORY_LABELS: Record<Exclude<Category, 'focal' | 'muted'>, string> = {
  core: 'CORE',
  async: 'ASYNC',
  tracking: 'TRACKING',
  runtime: 'RUNTIMES',
};

// ---------------------------------------------------------------------------
// Atomic element tile
// ---------------------------------------------------------------------------

export type ElementSize = 'sm' | 'md' | 'lg';

type SizeStyle = {
  dims: string;
  num: string;
  sym: string;
  name: string;
};

const SIZE_STYLES: Record<ElementSize, SizeStyle> = {
  sm: {
    dims: 'w-16 h-16 p-1.5',
    num: 'text-[9px] lg:text-[10px]',
    sym: 'text-lg',
    name: 'text-[9px] lg:text-[10px]',
  },
  md: {
    dims: 'w-20 h-20 p-2 lg:w-28 lg:h-28 lg:p-2.5',
    num: 'text-[9px] lg:text-[10px]',
    sym: 'text-3xl lg:text-4xl',
    name: 'text-[10px] lg:text-xs',
  },
  lg: {
    dims: 'w-28 h-28 p-3 lg:w-40 lg:h-40 lg:p-4',
    num: 'text-[11px] lg:text-xs',
    sym: 'text-5xl lg:text-6xl',
    name: 'text-[11px] lg:text-base',
  },
};

export type ElementProps = {
  num: number;
  sym: string;
  name: string;
  category?: Category;
  size?: ElementSize;
};

export function Element({
  num,
  sym,
  name,
  category = 'core',
  size = 'sm',
}: ElementProps) {
  const c = CATEGORY_STYLES[category];
  const s = SIZE_STYLES[size];
  return (
    <div
      className={clsx(
        s.dims,
        c.bg,
        c.border,
        c.hoverBorder,
        'flex cursor-default flex-col justify-between rounded-md border font-mono shadow-2xl transition-colors',
      )}
      role="img"
      aria-label={`${name}, atomic number ${num}, symbol ${sym}`}
    >
      <div className={clsx(s.num, c.num, 'font-medium')}>{num}</div>
      <div className="flex flex-col items-start">
        <div
          className={clsx(
            s.sym,
            c.text,
            'leading-none font-medium tracking-tight',
          )}
        >
          {sym}
        </div>
        <div className={clsx(s.name, c.name, 'mt-1 w-full truncate lowercase')}>
          {name}
        </div>
      </div>
    </div>
  );
}

export function CategoryLabel({
  children,
  category,
}: {
  children: ReactNode;
  category: Category;
}) {
  const c = CATEGORY_STYLES[category];
  return (
    <div
      className={clsx(
        c.label,
        'mb-2 font-mono text-[10px] tracking-[0.18em] select-none',
      )}
    >
      {children}
    </div>
  );
}

export function ElementsRow({
  category,
  elements,
}: {
  category: Exclude<Category, 'focal' | 'muted'>;
  elements: ElementProps[];
}) {
  return (
    <div>
      <CategoryLabel category={category}>
        {CATEGORY_LABELS[category]}
      </CategoryLabel>
      <div className="flex flex-wrap gap-1.5">
        {elements.map((e) => (
          <Element key={e.num} {...e} category={category} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Code block — uses prism-react-renderer (same engine as the docs Fence)
// ---------------------------------------------------------------------------

const CODE_THEME: PrismTheme = {
  plain: { color: '#e4e4ea' },
  styles: [
    { types: ['keyword', 'builtin', 'important'], style: { color: '#c084fc' } },
    { types: ['string', 'attr-value'], style: { color: '#fcd34d' } },
    { types: ['number', 'boolean'], style: { color: '#fb923c' } },
    { types: ['class-name'], style: { color: '#22d3ee' } },
    { types: ['function'], style: { color: '#38bdf8' } },
    { types: ['tag'], style: { color: '#f472b6' } },
    { types: ['attr-name'], style: { color: '#a5b4fc' } },
    { types: ['property'], style: { color: '#e4e4ea' } },
    { types: ['regex'], style: { color: '#34d399' } },
    {
      types: ['comment'],
      style: { color: '#4ade80', opacity: 0.7, fontStyle: 'italic' as const },
    },
    { types: ['punctuation'], style: { color: '#a1a1aa' } },
    { types: ['operator'], style: { color: '#fb7185' } },
  ],
};

export function CodeBlock({
  filename,
  lang = 'tsx',
  code,
  accent = false,
  compact = false,
}: {
  filename?: string;
  lang?: string;
  code: string;
  accent?: boolean;
  compact?: boolean;
}) {
  return (
    <div
      className={clsx(
        'overflow-hidden rounded-md border bg-primary-1000',
        accent ? 'border-tertiary-300/40' : 'border-primary-800',
      )}
    >
      {!compact && filename && (
        <div className="flex items-center justify-between border-b border-primary-800 px-3 py-2 font-mono text-[11px]">
          <span className="text-primary-300">{filename}</span>
          <span className="text-[9px] tracking-wider text-primary-500 uppercase">
            {lang}
          </span>
        </div>
      )}
      <Highlight code={code.trimEnd()} language={lang} theme={CODE_THEME}>
        {({ tokens, getLineProps, getTokenProps }) => (
          <pre
            className={clsx(
              'overflow-x-auto font-mono leading-relaxed',
              compact
                ? 'px-5 py-4 text-[13px] lg:text-[14px]'
                : 'px-3 py-3 text-[11px]',
            )}
          >
            <code>
              {tokens.map((line, i) => (
                <div key={i} {...getLineProps({ line })} className="flex">
                  {!compact && (
                    <span className="w-7 shrink-0 pr-3 text-right text-primary-700 select-none">
                      {i + 1}
                    </span>
                  )}
                  <span className="flex-1 whitespace-pre">
                    {line.map((token, j) => (
                      <Fragment key={j}>
                        {token.empty ? (
                          '\n'
                        ) : (
                          <span {...getTokenProps({ token })} />
                        )}
                      </Fragment>
                    ))}
                  </span>
                </div>
              ))}
            </code>
          </pre>
        )}
      </Highlight>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section primitives
// ---------------------------------------------------------------------------

export function Section({
  children,
  className,
  eyebrow,
  title,
  accent,
}: {
  children: ReactNode;
  className?: string;
  /**
   * Small label above the headline. Rendered as-written; pass it in the
   * exact case you want to see (lowercase reads quieter than tracked
   * uppercase and the design uses both).
   */
  eyebrow?: string;
  title?: ReactNode;
  accent?: ReactNode;
}) {
  return (
    <section className={clsx('flex flex-col justify-center py-16', className)}>
      {(eyebrow || title) && (
        <div className="mb-10 text-center">
          {eyebrow && (
            <div className="mb-3 font-mono text-xs text-primary-400">
              {eyebrow}
            </div>
          )}
          {title && (
            <h2 className="font-mono text-2xl leading-tight text-primary-50">
              {title}
              {accent && <span className="text-secondary-300"> {accent}</span>}
            </h2>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export function CTAButton({
  variant = 'primary',
  children,
  href = '#',
  arrow = false,
  external = false,
}: {
  variant?: 'primary' | 'secondary';
  children: ReactNode;
  href?: string;
  arrow?: boolean;
  external?: boolean;
}) {
  const styles =
    variant === 'primary'
      ? 'bg-tertiary-300 hover:bg-tertiary-200 text-tertiary-950 border-tertiary-300'
      : 'bg-transparent hover:bg-primary-900 text-primary-100 border-primary-700 hover:border-primary-500';
  const cls = clsx(
    'inline-flex items-center gap-1.5 rounded-md border px-5 py-2.5 font-mono text-sm font-medium transition-colors',
    styles,
  );
  if (external) {
    return (
      <a href={href} className={cls} target="_blank" rel="noreferrer">
        {children}
        {arrow && <span aria-hidden>→</span>}
      </a>
    );
  }
  return (
    <Link href={href} className={cls}>
      {children}
      {arrow && <span aria-hidden>→</span>}
    </Link>
  );
}

export function InstallCommand({ pkg = 'signalium' }: { pkg?: string }) {
  return (
    <div className="inline-flex items-center gap-3 rounded-md border border-primary-800 bg-primary-1000 px-4 py-3 font-mono text-sm">
      <span className="text-primary-500">$</span>
      <span className="text-primary-100">npm install {pkg}</span>
    </div>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-primary-800/80 px-2.5 py-1 font-mono text-[11px] text-primary-400">
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Legacy hero/CTA helpers (still referenced by index.tsx callers / Footer)
// ---------------------------------------------------------------------------

/**
 * Install + primary CTA pair used in the hero and final CTA. Wraps the new
 * `InstallCommand` and `CTAButton` so the call site reads cleanly.
 */
export function InstallCta({
  href = '/quickstart',
  label = 'Get started',
}: {
  href?: string;
  label?: string;
}) {
  return (
    <>
      <InstallCommand />
      <CTAButton variant="primary" href={href} arrow>
        {label}
      </CTAButton>
    </>
  );
}
