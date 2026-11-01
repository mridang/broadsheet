import type { ReactElement, ReactNode } from 'react';

import { cn } from '@/components/ui/cn';

/**
 * The top of an app page: its title, a line saying what the page is for, and
 * the page's own actions on the right (beneath, on a phone).
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: Readonly<{
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}>): ReactElement {
  return (
    <div
      className={cn(
        'flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted sm:text-base">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

/** A titled part of an app page, below its header. */
export function PageSection({
  id,
  title,
  description,
  children,
}: Readonly<{
  /** The heading's id, which the section is labelled by. */
  id: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}>): ReactElement {
  return (
    <section aria-labelledby={id} className="mt-12">
      <SectionHeader id={id} title={title} description={description} />
      <div className="mt-4">{children}</div>
    </section>
  );
}

/**
 * The heading of a group within a page: a title, an optional line beneath,
 * and the group's own actions (or a "See all" link) on the right.
 */
export function SectionHeader({
  id,
  as: Tag = 'h2',
  title,
  description,
  actions,
  className,
}: Readonly<{
  id?: string;
  as?: 'h2' | 'h3';
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}>): ReactElement {
  return (
    <div className={cn('flex items-end justify-between gap-4', className)}>
      <div className="min-w-0">
        <Tag id={id} className="text-lg font-semibold tracking-tight text-ink">
          {title}
        </Tag>
        {description ? (
          <p className="mt-1 text-sm text-muted">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2 text-sm">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
