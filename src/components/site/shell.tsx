import type { ReactElement, ReactNode } from 'react';

import { currentUser } from '@/lib/account';

import { SiteHeader } from './site-header';
import { SkipLink } from './skip-link';

/**
 * The frame shared by every page: the skip link, the masthead (which shows who
 * is signed in), and the page in the newspaper's column. The paper has no
 * footer; each edition ends with its own colophon.
 */
export async function SiteShell({
  children,
}: Readonly<{ children: ReactNode }>): Promise<ReactElement> {
  const user = await currentUser();
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
