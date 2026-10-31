import Link from 'next/link';
import type { ReactElement, ReactNode } from 'react';

import { BRAND_NAME } from '@/app/_brand';
import { Eyebrow, Heading } from '@/components/ui/layout';

/** How a link inside a legal page looks: underlined, in the accent colour. */
const LINK =
  'focus-ring rounded-control text-accent underline underline-offset-4 hover:text-ink';

/** A day as people write it, from an ISO date: "1 November 2026". */
export function longDate(isoDay: string): string {
  return new Date(`${isoDay}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * A legal page (the privacy policy or the terms): its eyebrow, title and the
 * day it last changed, then its sections, then the way back home. Every app
 * lays its legal pages out with this, inside its own page frame.
 */
export function LegalPage({
  eyebrow,
  title,
  updated,
  children,
}: Readonly<{
  eyebrow: string;
  title: string;
  /** The ISO day the page last changed. */
  updated: string;
  children: ReactNode;
}>): ReactElement {
  return (
    <div className="max-w-2xl">
      <Eyebrow>{eyebrow}</Eyebrow>
      <Heading as="h1" variant="h1" className="mt-2">
        {title}
      </Heading>
      <p className="mt-3 text-sm text-muted">
        Last updated: {longDate(updated)}
      </p>

      <div className="mt-8 space-y-9 text-lg leading-relaxed text-muted">
        {children}
      </div>

      <Link
        href="/"
        className="focus-ring mt-12 inline-flex h-10 items-center gap-1 text-sm font-semibold text-muted hover:text-ink"
      >
        <span aria-hidden="true">←</span>
        Back to {BRAND_NAME}
      </Link>
    </div>
  );
}

/** A titled block of a legal page: a heading, then its text or list. */
export function LegalSection({
  title,
  children,
}: Readonly<{
  title: string;
  children: ReactNode;
}>): ReactElement {
  return (
    <section>
      <Heading variant="h3">{title}</Heading>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** A list item with a marker in the brand colour, so lists read as part of the brand. */
export function LegalItem({
  children,
}: Readonly<{ children: ReactNode }>): ReactElement {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className="mt-[0.65rem] size-1.5 shrink-0 rounded-full bg-brand"
      />
      <span>{children}</span>
    </li>
  );
}

/**
 * A link inside a legal page. An address on another site opens in a new tab
 * without handing it a reference to this window; a page of this site is an
 * ordinary link.
 */
export function LegalLink({
  href,
  children,
}: Readonly<{ href: string; children: ReactNode }>): ReactElement {
  if (/^https?:\/\//i.test(href)) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={LINK}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={LINK}>
      {children}
    </Link>
  );
}

/** A name in code type inside a legal page, such as a cookie's name. */
export function LegalCode({
  children,
}: Readonly<{ children: ReactNode }>): ReactElement {
  return <code className="font-mono text-base">{children}</code>;
}
