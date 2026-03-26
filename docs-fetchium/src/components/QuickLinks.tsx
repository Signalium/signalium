import Link from 'next/link';

import { Icon } from '@/components/Icon';

export function QuickLinks({ children }: { children: React.ReactNode }) {
  return (
    <div className="not-prose my-12 grid grid-cols-1 gap-6 sm:grid-cols-2">
      {children}
    </div>
  );
}

export function QuickLink({
  title,
  description,
  href,
  icon,
}: {
  title: string;
  description: string;
  href: string;
  icon: React.ComponentProps<typeof Icon>['icon'];
}) {
  return (
    <div className="group relative rounded-xl border border-secondary-400/10">
      <div className="absolute -inset-px rounded-xl border-2 border-transparent opacity-0 transition-opacity duration-300 [--quick-links-hover-bg:var(--color-primary-900)] [background:linear-gradient(var(--quick-links-hover-bg,var(--color-primary-50)),var(--quick-links-hover-bg,var(--color-primary-50)))_padding-box,linear-gradient(to_top,var(--color-secondary-400),var(--color-tertiary-400),var(--color-secondary-300))_border-box] group-hover:opacity-100" />
      <div className="relative overflow-hidden rounded-xl p-6">
        <Icon icon={icon} className="h-8 w-8" />
        <h2 className="mt-4 font-display text-base text-white">
          <Link href={href}>
            <span className="absolute -inset-px rounded-xl" />
            {title}
          </Link>
        </h2>
        <p className="mt-1 text-sm text-primary-300">{description}</p>
      </div>
    </div>
  );
}
