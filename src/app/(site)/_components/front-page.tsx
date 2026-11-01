import type { ReactElement, ReactNode } from 'react';

import { cn } from '@/components/ui/cn';
import { PageHeader } from '@/components/ui/page-header';

/**
 * The frame of a day's paper: its title and the date controls, the row of
 * editions, the paper itself, and (on a wide screen) a column beside it.
 */
export function FrontPage({
  title,
  description,
  bar,
  switcher,
  side,
  children,
}: Readonly<{
  title: string;
  description: string;
  /** The day's navigation, at the header's right. */
  bar: ReactNode;
  /** The editions to switch between, under the header. */
  switcher?: ReactNode;
  /** What stands beside the paper on a wide screen, below it otherwise. */
  side?: ReactNode;
  children: ReactNode;
}>): ReactElement {
  return (
    <div
      className={cn(
        side != null && 'xl:grid xl:grid-cols-[minmax(0,1fr)_18rem] xl:gap-10',
      )}
    >
      <div className="min-w-0">
        <PageHeader title={title} description={description} actions={bar} />
        {switcher ? <div className="mt-6">{switcher}</div> : null}
        <div className="mt-8">{children}</div>
      </div>
      {side ? (
        <div className="mt-12 xl:sticky xl:top-24 xl:mt-0 xl:self-start">
          {side}
        </div>
      ) : null}
    </div>
  );
}
