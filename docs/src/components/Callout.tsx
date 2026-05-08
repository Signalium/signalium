import clsx from 'clsx';

const styles = {
  note: {
    container: 'border-l-2 border-secondary-400 bg-secondary-900/20',
    title:
      'text-secondary-300 mt-0 mb-2 uppercase text-xs font-semibold tracking-wider',
    body: 'text-primary-200 prose-code:text-primary-100',
  },
  warning: {
    container: 'border-l-2 border-tertiary-400 bg-tertiary-900/20',
    title:
      'text-tertiary-400 mt-0 mb-2 uppercase text-xs font-semibold tracking-wider',
    body: 'prose-a:text-tertiary-300 text-primary-200 prose-code:text-primary-100',
  },
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
  return (
    <div className={clsx('my-8 rounded-lg p-5', styles[type].container)}>
      <p className={clsx('m-0', styles[type].title)}>{title}</p>
      <div className={clsx('prose mt-2 text-sm', styles[type].body)}>
        {children}
      </div>
    </div>
  );
}
