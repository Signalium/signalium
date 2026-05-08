import clsx from 'clsx';

export function SgTile({
  className,
  size = 'sm',
}: {
  className?: string;
  size?: 'sm' | 'md';
}) {
  const ismd = size === 'md';

  return (
    <div
      className={clsx(
        'relative flex flex-col items-center justify-center rounded-md border border-primary-800 bg-primary-900',
        ismd ? 'h-11 w-11' : 'h-9 w-9',
        className,
      )}
    >
      <span
        className={clsx(
          'absolute top-1 left-1.5 font-display text-secondary-300/80',
          ismd ? 'text-[7px]' : 'text-[6px]',
        )}
      >
        01
      </span>
      <span
        className={clsx(
          'font-mono leading-none font-bold text-tertiary-300',
          ismd ? 'text-lg' : 'text-base',
        )}
      >
        Sg
      </span>
      <span
        className={clsx(
          'font-display text-primary-400/70 uppercase',
          ismd ? 'text-[6px]' : 'text-[5px]',
        )}
      >
        signal
      </span>
    </div>
  );
}

export function Logomark({
  className,
  ...props
}: React.ComponentPropsWithoutRef<'div'>) {
  return <SgTile className={className} size="sm" {...props} />;
}

export function Logo({
  className,
  ...props
}: React.ComponentPropsWithoutRef<'div'>) {
  return (
    <div className={clsx('flex items-center gap-2.5', className)} {...props}>
      <SgTile size="sm" />
      <span className="font-display text-[16px] font-medium text-white">
        signalium
      </span>
    </div>
  );
}
