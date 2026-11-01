import type { ComponentProps, ReactElement, ReactNode } from 'react';

import { cn } from '@/components/ui/cn';

/** The colours of each kind of badge. */
const TONES = {
  neutral: 'bg-ink/[0.06] text-muted',
  accent: 'bg-accent/10 text-accent',
  danger: 'bg-danger/10 text-danger',
  success: 'bg-success/10 text-success',
  /** Just the outline: a fact that should not draw the eye. */
  outline: 'border border-line text-muted',
} as const;

/** The tone names a badge can take. */
export type BadgeTone = keyof typeof TONES;

/**
 * A small label that says something about what it sits beside: a count, a
 * state ("Failing", "Match"), a kind. It does nothing when clicked; for a
 * pill that does, use `Chip`.
 */
export function Badge({
  tone = 'neutral',
  className,
  children,
}: Readonly<{
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}>): ReactElement {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap tabular-nums',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * The look of a chip: a small pill you can press, tinted in the accent colour
 * while pressed (`aria-pressed`) or current (`aria-current`). Exported for a
 * `<summary>` or a link that must look the same.
 */
export const CHIP =
  'focus-ring inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-xs font-medium whitespace-nowrap text-muted transition-colors hover:border-field hover:text-ink active:bg-ink/5 aria-pressed:border-accent/50 aria-pressed:bg-accent/5 aria-pressed:text-accent aria-[current=page]:border-ink aria-[current=page]:bg-ink aria-[current=page]:text-on-ink disabled:cursor-not-allowed disabled:opacity-50';

/** A small pill button: a filter, a tag, a quick action. */
export function Chip({
  className,
  children,
  ...props
}: Readonly<ComponentProps<'button'>>): ReactElement {
  return (
    <button type="button" className={cn(CHIP, className)} {...props}>
      {children}
    </button>
  );
}
