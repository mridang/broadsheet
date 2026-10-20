import Link from 'next/link';
import type { ReactElement, ReactNode } from 'react';

import { BRAND_NAME } from '@/app/_brand';
import { BrandMark } from '@/components/site/logo';
import { SkipLink } from '@/components/site/skip-link';
import { Container, Eyebrow, Heading } from '@/components/ui/layout';

/**
 * A page outside the site frame: the thin brand strip, the wordmark and a
 * centred message. Used where the full header would be wrong or unavailable:
 * the not-found and error pages, and any other page that stands alone. It
 * brings its own `<main>` because it does not sit inside the site shell.
 */
export function BarePage({
  children,
}: Readonly<{ children: ReactNode }>): ReactElement {
  return (
    <div className="flex flex-1 flex-col">
      <SkipLink />
      <header>
        <div className="h-1.5 bg-brand" />
        <div className="border-b border-line">
          <Container className="flex h-17 items-center">
            <Link
              href="/"
              className="focus-ring-wide rounded-control font-display text-[1.7rem] leading-none font-bold tracking-tight text-ink"
            >
              {BRAND_NAME}
            </Link>
          </Container>
        </div>
      </header>
      <main id="main" className="flex flex-1 items-center">
        {children}
      </main>
    </div>
  );
}

/**
 * A full-page message with a headline and a way onward: what the not-found and
 * error pages say. `actions` are the buttons beneath the text. (For a short
 * note inside a page, use `Callout`.)
 */
export function MessagePage({
  eyebrow,
  title,
  children,
  actions,
}: Readonly<{
  eyebrow: string;
  /** The page's one `h1`. */
  title: string;
  /** The explanation under the headline. */
  children: ReactNode;
  actions: ReactNode;
}>): ReactElement {
  return (
    <Container className="py-16 sm:py-24">
      <div className="max-w-xl">
        <BrandMark className="size-14" />
        <Eyebrow className="mt-6">{eyebrow}</Eyebrow>
        <Heading as="h1" variant="h1" className="mt-3">
          {title}
        </Heading>
        <div className="mt-5 text-lg leading-relaxed text-muted">
          {children}
        </div>
        <div className="mt-8 flex flex-wrap gap-3">{actions}</div>
      </div>
    </Container>
  );
}
