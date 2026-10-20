import type { ElementType, ReactElement, ReactNode, Ref } from 'react';

import { cn } from '@/components/ui/cn';

/** The page column: one max width and one set of gutters, used everywhere. */
export function Container({
  children,
  className,
  as: Tag = 'div',
}: Readonly<{
  children: ReactNode;
  className?: string;
  /** The tag to render, when a `div` is not the right element. */
  as?: ElementType;
}>): ReactElement {
  return (
    <Tag
      className={cn(
        'mx-auto w-full max-w-360 px-4 sm:px-6 lg:px-10',
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/** The colour of an eyebrow line. */
const EYEBROW_TONES = {
  /** The accent colour, for the line that introduces a heading. */
  accent: 'text-accent',
  /** Plain ink, for use on a coloured band. */
  ink: 'text-ink',
  /** Quiet grey, for the label of a group or a fact. */
  subtle: 'text-subtle',
} as const;

/**
 * The small tracked-caps line above a heading, or the label of a group. `tone`
 * picks its colour (do not pass a colour class: classes are joined, not merged,
 * so two colours would fight); `as` changes the tag when it labels a term or a
 * heading rather than being a paragraph.
 */
export function Eyebrow({
  as: Tag = 'p',
  tone = 'accent',
  children,
  className,
}: Readonly<{
  as?: ElementType;
  tone?: keyof typeof EYEBROW_TONES;
  children: ReactNode;
  className?: string;
}>): ReactElement {
  return (
    <Tag
      className={cn(
        'text-label font-semibold uppercase',
        EYEBROW_TONES[tone],
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/** The type size and line height of each heading level. */
const HEADINGS = {
  display: 'text-5xl leading-[1.04] sm:text-6xl lg:text-7xl',
  h1: 'text-4xl leading-[1.08] sm:text-5xl',
  h2: 'text-3xl leading-tight sm:text-4xl',
  h3: 'text-2xl leading-tight',
  h4: 'text-xl leading-snug',
} as const;

/**
 * A heading in the display serif. `variant` sets the size, `as` the HTML tag.
 * `ref` and `tabIndex` are for a page that moves focus to its heading when its
 * content changes (give it `tabIndex={-1}` so a script can focus it without
 * adding it to the Tab order).
 */
export function Heading({
  variant = 'h2',
  as: Tag = 'h2',
  children,
  className,
  ref,
  tabIndex,
}: Readonly<{
  variant?: keyof typeof HEADINGS;
  as?: ElementType;
  children: ReactNode;
  className?: string;
  ref?: Ref<HTMLHeadingElement>;
  tabIndex?: number;
}>): ReactElement {
  return (
    <Tag
      ref={ref}
      tabIndex={tabIndex}
      className={cn(
        'font-display font-semibold tracking-tight',
        HEADINGS[variant],
        className,
      )}
    >
      {children}
    </Tag>
  );
}
