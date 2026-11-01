import type { ReactElement, ReactNode } from 'react';

/** A quiet message that stands where content would be: "nothing here yet". */
export function EmptyState({
  title,
  children,
  action,
}: Readonly<{
  title: string;
  children?: ReactNode;
  /** A button or link beneath the text. */
  action?: ReactNode;
}>): ReactElement {
  return (
    <div className="rounded-card border border-dashed border-line bg-surface px-6 py-12 text-center">
      <p className="text-base font-semibold text-ink">{title}</p>
      {children ? (
        <div className="mx-auto mt-2 max-w-md text-sm text-muted">
          {children}
        </div>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/** A failed action's message, read out as soon as it appears. */
export function ErrorText({
  children,
}: Readonly<{ children: ReactNode }>): ReactElement {
  return (
    <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">
      {children}
    </p>
  );
}
