import type { Metadata } from 'next';

import type { ReactElement } from 'react';

import { ButtonLink } from '@/components/ui/button';
import { Eyebrow, Heading } from '@/components/ui/layout';

/** The tab title for the not-found page, kept out of search results. */
export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false },
};

/**
 * Shown inside the paper's own frame (its header and sidebar) when a story,
 * feed or briefing link points at nothing, so the page keeps one header
 * rather than drawing the bare not-found page inside the app.
 */
export default function SiteNotFound(): ReactElement {
  return (
    <div className="max-w-2xl py-12 sm:py-20">
      <Eyebrow>Page not found</Eyebrow>
      <Heading as="h1" variant="h1" className="mt-3">
        We couldn&apos;t find that page
      </Heading>
      <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">
        The story or feed may have been removed, or the link is out of date. The
        rest of your paper is right where you left it.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <ButtonLink href="/" size="lg">
          Back to the front page
        </ButtonLink>
        <ButtonLink href="/search" size="lg" variant="outline">
          Search the archive
        </ButtonLink>
      </div>
    </div>
  );
}
