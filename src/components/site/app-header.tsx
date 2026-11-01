import type { ReactElement, ReactNode } from 'react';

import { BRAND_NAME } from '@/app/_brand';
import type { User } from '@/domain/repository';

import { Wordmark } from '@/components/site/logo';
import { SignOutButton } from '@/components/site/sign-out-button';
import { ButtonLink, TextLink } from '@/components/ui/button';
import { MENU_ITEM, Menu, MenuDivider } from '@/components/ui/menu';
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
    <header
      data-top-bar=""
      className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur print:hidden"
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
        <details className="group lg:hidden">
          <summary
            aria-label="Menu"
            className="focus-ring inline-flex size-10 list-none items-center justify-center rounded-control text-muted transition-colors hover:bg-ink/5 hover:text-ink active:bg-ink/10 [&::-webkit-details-marker]:hidden"
          >
            <Icon name="menu" />
          </summary>
          <div className="absolute inset-x-0 top-16 max-h-[calc(100dvh-4rem)] overflow-y-auto border-b border-line bg-paper px-4 py-6 shadow-overlay sm:px-6">
            {menu}
          </div>
        </details>
        <a href="/" className="focus-ring-wide rounded-control">
          <Wordmark name={BRAND_NAME} />
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
              className="w-full rounded-full border-line pl-9"
            />
          </label>
        </form>
        <div className="ml-auto flex items-center gap-3 md:ml-0">
          {user ? (
            <Menu
              label="Account"
              width="w-64"
              triggerClassName="focus-ring flex size-9 items-center justify-center rounded-full bg-ink/10 text-sm font-semibold text-ink uppercase transition-colors hover:bg-ink/15 active:bg-ink/20"
              trigger={(user.name || user.email).slice(0, 1)}
            >
              <AccountPanel user={user} />
            </Menu>
          ) : (
            <ButtonLink size="sm" href="/login">
              Sign in
            </ButtonLink>
          )}
        </div>
      </div>
    </header>
  );
}

/** What the account menu holds: who is signed in, Settings, and Sign out. */
export function AccountPanel({ user }: Readonly<{ user: User }>): ReactElement {
  return (
    <>
      <div className="px-3 py-2">
        {user.name ? (
          <p className="truncate text-sm font-medium text-ink">{user.name}</p>
        ) : null}
        <p className="truncate text-xs text-subtle">{user.email}</p>
      </div>
      <MenuDivider />
      <TextLink bare href="/settings" className={MENU_ITEM}>
        Settings
      </TextLink>
      <SignOutButton />
    </>
  );
}
