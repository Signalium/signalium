import clsx from 'clsx';

import { Icon } from '@/components/Icon';

const styles = {
  note: {
    container: 'bg-primary-900/50 ring-1 ring-inset ring-primary-400/20',
    title: 'text-secondary-200 mt-0 mb-2',
    body: 'text-slate-100 [--tw-prose-background:var(--color-sky-50)] prose-code:text-slate-100',
  },
  warning: {
    container: 'bg-primary-900/50 ring-1 ring-inset ring-primary-400/20',
    title: 'text-amber-500 mt-0 mb-2',
    body: '[--tw-prose-background:var(--color-amber-50)] prose-a:text-amber-900 text-slate-100 [--tw-prose-underline:var(--color-sky-700)] prose-code:text-slate-100',
  },
};

const icons = {
  note: (props: { className?: string }) => <Icon icon="lightbulb" {...props} />,
  warning: (props: { className?: string }) => (
    <Icon icon="warning" color="amber" {...props} />
  ),
};

export function Callout({
  title,
  children,
  type = 'note',
}: {
  title: string;
  children: React.ReactNode;
  type?: keyof typeof styles;
}) {
  let IconComponent = icons[type];

  return (
    <div className={clsx('my-8 flex rounded-3xl p-6', styles[type].container)}>
      <IconComponent className="h-8 w-8 flex-none" />
      <div className="ml-4 flex-auto">
        <p className={clsx('m-0 font-display text-xl', styles[type].title)}>
          {title}
        </p>
        <div className={clsx('prose mt-2.5 text-sm', styles[type].body)}>
          {children}
        </div>
      </div>
    </div>
  );
}
