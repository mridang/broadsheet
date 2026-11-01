import type { ReactElement, ReactNode } from 'react';

import { SiteShell } from '@/components/site/shell';

/** The paper itself (today's and back issues) keeps the newspaper's masthead. */
export default function PaperLayout({
  children,
}: Readonly<{ children: ReactNode }>): ReactElement {
  return <SiteShell>{children}</SiteShell>;
}
