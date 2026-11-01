import type { ReactElement, ReactNode } from 'react';

import { AppShell } from '@/components/site/app-shell';

/** Every page but the paper shares the app's top bar and sidebar. */
export default function SiteLayout({
  children,
}: Readonly<{ children: ReactNode }>): ReactElement {
  return <AppShell>{children}</AppShell>;
}
