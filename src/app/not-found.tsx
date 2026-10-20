import type { Metadata } from 'next';
import type { ReactElement } from 'react';

import { BarePage, MessagePage } from '@/components/site/bare-page';
import { ButtonLink } from '@/components/ui/button';

import { NOT_FOUND_LINK, NOT_FOUND_NOTE } from './_brand';

/** The tab title (the layout's template adds the app's name), and a note to crawlers that this is not a page to index. */
export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false },
};

/**
 * What anyone sees for an address that leads nowhere: a plain explanation and
 * a way back (or two, if the app has somewhere else worth sending people).
 */
export default function NotFound(): ReactElement {
  return (
    <BarePage>
      <MessagePage
        eyebrow="Page not found"
        title="We couldn't find that page"
        actions={
          <>
            <ButtonLink href="/" size="lg">
              Back to the home page
            </ButtonLink>
            {NOT_FOUND_LINK ? (
              <ButtonLink
                href={NOT_FOUND_LINK.href}
                variant="outline"
                size="lg"
              >
                {NOT_FOUND_LINK.label}
              </ButtonLink>
            ) : null}
          </>
        }
      >
        <p>{NOT_FOUND_NOTE}</p>
      </MessagePage>
    </BarePage>
  );
}
