import type { ReactElement, ReactNode } from 'react';

import { BRAND_NAME } from '@/app/_brand';
import type { User } from '@/domain/repository';

import { BrandMark } from '@/components/site/logo';
import { SignOutButton } from '@/components/site/sign-out-button';
import { buttonClass } from '@/components/ui/button';
import { fieldClass } from '@/components/ui/field';
import { Icon } from '@/components/ui/icons';

/**
 * The bar across the top of every app page: the name (home to the paper), a
 * search box, and who is signed in. On a phone, `menu` (the sidebar) opens
 * from the button at its left as a drawer.
 */
export function AppHeader({
  user,
  menu,
}: Readonly<{ user: User | null; menu: ReactNode }>): ReactElement {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
        <details className="group lg:hidden">
          <summary
            className={buttonClass({
              variant: 'ghost',
              size: 'sm',
              className: 'list-none px-2 [&::-webkit-details-marker]:hidden',
            })}
          >
            <Icon name="menu" />
            <span className="sr-only">Menu</span>
          </summary>
          <div className="absolute inset-x-0 top-16 max-h-[calc(100dvh-4rem)] overflow-y-auto border-b border-line bg-paper px-4 py-6 shadow-lg sm:px-6">
            {menu}
          </div>
        </details>
        <a
          href="/"
          className="focus-ring-wide flex items-center gap-2 rounded-control text-base font-semibold tracking-tight text-ink"
        >
          <BrandMark className="size-5" />
          {BRAND_NAME}
        </a>
        <form
          action="/search"
          method="get"
          role="search"
          className="ml-auto hidden w-full max-w-xs md:block"
        >
          <label className="relative block">
            <span className="sr-only">Search the archive</span>
            <Icon
              name="search"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle"
            />
            <input
              name="q"
              type="search"
              maxLength={200}
              placeholder="Search stories"
              className={fieldClass('w-full rounded-full border-line pl-9')}
            />
          </label>
        </form>
        <div className="ml-auto flex items-center gap-3 md:ml-0">
          {user ? (
            <>
              <span className="hidden max-w-40 truncate text-sm text-muted sm:inline">
                {user.name || user.email}
              </span>
              <SignOutButton
                className={buttonClass({ variant: 'outline', size: 'sm' })}
              />
            </>
          ) : (
            <a
              className={buttonClass({ variant: 'primary', size: 'sm' })}
              href="/login"
            >
              Sign in
            </a>
          )}
        </div>
      </div>
    </header>
  );
}
