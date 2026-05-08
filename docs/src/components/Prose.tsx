import clsx from 'clsx';

export function Prose<T extends React.ElementType = 'div'>({
  as,
  className,
  ...props
}: React.ComponentPropsWithoutRef<T> & {
  as?: T;
}) {
  let Component = as ?? 'div';

  return (
    <Component
      className={clsx(
        className,
        'prose max-w-none text-primary-200 prose-slate prose-invert',
        // headings
        'prose-headings:scroll-mt-20 prose-headings:font-display prose-headings:font-normal prose-headings:text-white',
        // lead
        'prose-lead:text-primary-300',
        // links
        'prose-a:font-semibold prose-a:text-secondary-300 prose-a:transition-all prose-a:hover:text-secondary-200',
        // link underline
        '[--tw-prose-background:var(--color-primary-950)] prose-a:no-underline prose-a:shadow-[inset_0_calc(-1*var(--tw-prose-underline-size,2px))_0_0_var(--tw-prose-underline,var(--color-secondary-400))] prose-a:transition-all prose-a:hover:[--tw-prose-underline-size:1.5em]',
        // pre
        'prose-pre:rounded-xl prose-pre:border prose-pre:border-primary-800 prose-pre:bg-primary-1000 prose-pre:shadow-none',
        // hr
        'prose-hr:border-primary-800',
        // strong
        'prose-strong:text-white',
        // inline code
        'prose-code:text-secondary-300',
      )}
      {...props}
    />
  );
}
