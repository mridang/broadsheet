import { Icon, type IconName } from '@/components/ui/icons';
import type { ReactElement, ReactNode } from 'react';

/** A quiet message that stands where content would be: "nothing here yet". */
export function EmptyState({
  title,
  icon,
  children,
  action,
}: Readonly<{
  title: string;
  /** A line icon above the title. */
  icon?: IconName;
  children?: ReactNode;
  /** A button or link beneath the text. */
  action?: ReactNode;
}>): ReactElement {
  return (
    <div className="rounded-card border border-dashed border-line px-6 py-14 text-center">
      {icon ? (
        <span className="mx-auto mb-4 flex size-11 items-center justify-center rounded-full bg-ink/5 text-subtle">
          <Icon name={icon} />
        </span>
      ) : null}
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
    <p role="alert" className="mt-2 text-sm text-danger">
      {children}
    </p>
  );
}

/** The colours of each kind of notice. */
const NOTICE_TONES = {
  info: 'border-line bg-ink/[0.03] text-ink',
  danger: 'border-danger/30 bg-danger/5 text-danger',
  success: 'border-success/30 bg-success/5 text-success',
} as const;

/** A boxed message across the page: a warning, a result, a tip. */
export function Notice({
  tone = 'info',
  role,
  children,
}: Readonly<{
  tone?: keyof typeof NOTICE_TONES;
  role?: 'status' | 'alert';
  children: ReactNode;
}>): ReactElement {
  return (
    <div
      role={role}
      className={`rounded-card border px-4 py-3 text-sm ${NOTICE_TONES[tone]}`}
    >
      {children}
    </div>
  );
}
