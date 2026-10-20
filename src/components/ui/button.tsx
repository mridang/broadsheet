import Link from 'next/link';
import type { ComponentProps, ReactElement, ReactNode } from 'react';

import { cn } from '@/components/ui/cn';

/** The colours of each kind of button. */
const VARIANTS = {
  primary: 'bg-ink text-on-ink hover:bg-ink/85',
  accent: 'bg-highlight text-on-highlight hover:bg-highlight/90',
  outline: 'border border-field bg-surface text-ink hover:border-ink',
  ghost: 'text-ink hover:bg-ink/5',
} as const;

/**
 * The height, gap and side padding of each size. `wide` is `md` with roomier
 * sides, for a text-only button that sits inside a field (the Search button).
 */
const SIZES = {
  sm: 'h-9 gap-1.5 px-3 text-sm',
  md: 'h-10 gap-2 px-4 text-sm',
  wide: 'h-10 gap-2 px-5 text-sm',
  lg: 'h-12 gap-2 px-6 text-base',
} as const;

/** What a button looks like: its colours, its size, and any extra layout classes. */
type Look = Readonly<{
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  className?: string;
}>;

/** The class list for a button look; shared by buttons and button-styled links. */
export function buttonClass({
  variant = 'primary',
  size = 'md',
  className,
}: Look): string {
  return cn(
    'inline-flex shrink-0 items-center justify-center rounded-control font-semibold whitespace-nowrap transition',
    'focus-ring',
    'disabled:cursor-not-allowed disabled:opacity-50',
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

/**
 * A button. It is `type="button"` unless you say otherwise, so one inside a
 * form never submits it by accident; pass `type="submit"` for the one that
 * should.
 */
export function Button({
  variant,
  size,
  className,
  children,
  ...props
}: Look & Readonly<ComponentProps<'button'>>): ReactElement {
  return (
    <button
      type="button"
      className={buttonClass({ variant, size, className })}
      {...props}
    >
      {children}
    </button>
  );
}

/**
 * Whether an address is one of our API routes. Those answer with a redirect to
 * another site (Google), which the client router can't follow, so a link to one
 * must be a plain `<a>` that the browser follows itself.
 */
export function isApiHref(href: string): boolean {
  return href.startsWith('/api/');
}

/** A link that looks like a button. */
export function ButtonLink({
  variant,
  size,
  className,
  href,
  children,
}: Look & Readonly<{ href: string; children: ReactNode }>): ReactElement {
  const classes = buttonClass({ variant, size, className });
  if (isApiHref(href)) {
    return (
      <a href={href} className={classes}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={classes}>
      {children}
    </Link>
  );
}
