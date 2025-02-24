import Link from 'next/link';
import clsx from 'clsx';

const variantStyles = {
  primary:
    'rounded-full bg-purple-300 py-2 px-4 text-sm font-semibold text-slate-900 hover:bg-secondary-200 focus:outline-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-300/50 active:bg-secondary-500 transition-all',
  secondary:
    'rounded-full bg-primary-900 py-2 px-4 text-sm font-medium text-white hover:bg-primary-800 focus:outline-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/50 active:text-slate-300 transition-all',
};

type ButtonProps = {
  variant?: keyof typeof variantStyles;
} & (
  | React.ComponentPropsWithoutRef<typeof Link>
  | (React.ComponentPropsWithoutRef<'button'> & { href?: undefined })
);

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonProps) {
  className = clsx(variantStyles[variant], className);

  return typeof props.href === 'undefined' ? (
    <button className={className} {...props} />
  ) : (
    <Link className={className} {...props} />
  );
}
