import type { ReactElement, ReactNode } from 'react';

import { SiteShell } from '@/components/site/shell';

/** Every public and signed-in page shares the same header and footer. */
export default function SiteLayout({
  children,
}: Readonly<{ children: ReactNode }>): ReactElement {
  return <SiteShell>{children}</SiteShell>;
}
