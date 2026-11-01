'use client';

import { usePathname } from 'next/navigation';
import type { ReactElement, ReactNode } from 'react';

import { cn } from '@/components/ui/cn';

/**
 * A link down the side of the app: a row that is tinted while hovered and
 * marked as the current page while it is the one open. `current` says so
 * outright; without it, the address bar decides.
 */
export function SidebarLink({
  href,
  current,
  children,
}: Readonly<{
  href: string;
  current?: boolean;
  children: ReactNode;
}>): ReactElement {
  const pathname = usePathname();
  const active = current ?? pathname === href;
  return (
    <a
      aria-current={active ? 'page' : undefined}
      href={href}
      className={cn(
        'focus-ring flex h-9 items-center gap-3 rounded-control px-3 text-sm transition-colors active:bg-ink/10',
        active
          ? 'bg-ink/5 font-semibold text-ink'
          : 'text-muted hover:bg-ink/5 hover:text-ink',
      )}
    >
      {children}
    </a>
  );
}
