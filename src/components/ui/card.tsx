import type { ElementType, ReactElement, ReactNode } from 'react';

import { cn } from '@/components/ui/cn';

/** The inner padding of each card size. */
const PADDING = {
  none: '',
  sm: 'p-4',
  md: 'p-5 sm:p-6',
} as const;

/**
 * A white panel with a hairline edge, which groups one thing on a page.
 * `interactive` lifts it under the pointer, for a card that is one big link.
 */
export function Card({
  as: Tag = 'div',
  padding = 'md',
  interactive = false,
  className,
  children,
}: Readonly<{
  as?: ElementType;
  padding?: keyof typeof PADDING;
  interactive?: boolean;
  className?: string;
  children: ReactNode;
}>): ReactElement {
  return (
    <Tag
      className={cn(
        'rounded-card border border-line bg-surface',
        PADDING[padding],
        interactive &&
          'transition-shadow hover:border-field/40 hover:shadow-raised',
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/**
 * A list of rows divided by hairlines, inside a card: feeds, tokens, rules,
 * saved searches. Its children are `ListItem`s.
 */
export function List({
  label,
  className,
  children,
}: Readonly<{
  /** What the list is, for a screen reader, when no heading names it. */
  label?: string;
  className?: string;
  children: ReactNode;
}>): ReactElement {
  return (
    <ul
      aria-label={label}
      className={cn(
        'divide-y divide-line overflow-hidden rounded-card border border-line bg-surface',
        className,
      )}
    >
      {children}
    </ul>
  );
}

/**
 * One row of a `List`: an optional leading picture or icon, a title with a
 * line of detail beneath, and the row's own actions on the right (beneath, on
 * a phone).
 */
export function ListItem({
  leading,
  title,
  detail,
  actions,
  className,
  children,
}: Readonly<{
  leading?: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  actions?: ReactNode;
  className?: string;
  /** Anything more, beneath the row (a settings form, say). */
  children?: ReactNode;
}>): ReactElement {
  return (
    <li className={cn('px-4 py-3.5 sm:px-5', className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {leading ? <span className="shrink-0">{leading}</span> : null}
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-ink">{title}</div>
            {detail ? (
              <div className="mt-0.5 text-xs text-subtle">{detail}</div>
            ) : null}
          </div>
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        ) : null}
      </div>
      {children}
    </li>
  );
}
