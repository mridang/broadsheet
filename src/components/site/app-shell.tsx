import type { ReactElement, ReactNode } from 'react';

import { getDatabase } from '@/domain/db/database';
import { Repository } from '@/domain/repository';
import { getCurrentUser } from '@/lib/core/auth';

import { AppHeader } from '@/components/site/app-header';
import { AppSidebar } from '@/components/site/app-sidebar';
import { SkipLink } from '@/components/site/skip-link';

/**
 * The frame of every page but the paper: the skip link, the top bar, the
 * sidebar of places and feeds (a drawer on a phone) and the page in a calm
 * reading column beside it.
 */
export async function AppShell({
  children,
}: Readonly<{ children: ReactNode }>): Promise<ReactElement> {
  const user = await getCurrentUser();
  let feeds: Parameters<typeof AppSidebar>[0]['feeds'] = [];
  if (user) {
    const repo = new Repository(getDatabase());
    const [list, counts] = await Promise.all([
      repo.listFeeds(user.id),
      repo.storyCounts(user.id),
    ]);
    feeds = list.map((f) => ({ ...f, count: counts.get(f.id) ?? 0 }));
  }
  const sidebar = <AppSidebar user={user} feeds={feeds} />;
  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <AppHeader user={user} menu={sidebar} />
      <div className="mx-auto flex w-full max-w-7xl flex-1 gap-10 px-4 sm:px-6 lg:px-8">
        <aside className="sticky top-16 hidden h-[calc(100dvh-4rem)] w-60 shrink-0 self-start overflow-y-auto py-8 lg:block print:hidden">
          {sidebar}
        </aside>
        <main
          id="main"
          tabIndex={-1}
          className="min-w-0 flex-1 pt-8 pb-20 outline-none sm:pt-10"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
