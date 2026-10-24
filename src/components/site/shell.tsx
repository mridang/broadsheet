import type { ReactElement, ReactNode } from 'react';

import { getCurrentUser } from '@/core/auth/current-user';

import { SiteHeader } from '@/components/site/site-header';
import { SkipLink } from '@/components/site/skip-link';

/**
 * The frame shared by every page: the skip link, the masthead (which shows who
 * is signed in), and the page in the newspaper's column. The paper has no
 * footer; each edition ends with its own colophon.
 */
export async function SiteShell({
  children,
}: Readonly<{ children: ReactNode }>): Promise<ReactElement> {
  const user = await getCurrentUser();
  return (
    <>
      <SkipLink />
      <SiteHeader user={user} />
      <main id="main" className="wrap">
        {children}
      </main>
    </>
  );
}
