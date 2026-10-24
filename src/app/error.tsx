'use client';

import type { ReactElement } from 'react';

import { BarePage, MessagePage } from '@/components/site/bare-page';
import { Button, ButtonLink } from '@/components/ui/button';

import { ERROR_REASSURANCE } from '@/app/_brand';

/**
 * The page shown when something breaks while a page is being built or run.
 * "Try again" asks Next to re-render the page, which clears a passing hiccup;
 * the link goes home for anything that does not. The digest is the reference
 * to quote when looking the failure up in the server logs.
 */
export default function ErrorPage({
  error,
  unstable_retry,
}: Readonly<{
  /** What was thrown; Next adds a `digest` that matches the server log entry. */
  error: Error & { digest?: string };
  /** Asks Next to render the page again. */
  unstable_retry: () => void;
}>): ReactElement {
  return (
    <BarePage>
      <MessagePage
        eyebrow="Something went wrong"
        title="That didn't work"
        actions={
          <>
            <Button size="lg" onClick={() => unstable_retry()}>
              Try again
            </Button>
            <ButtonLink href="/" variant="outline" size="lg">
              Back to the home page
            </ButtonLink>
          </>
        }
      >
        <p>Something went wrong on our side. {ERROR_REASSURANCE}</p>
        {error.digest ? (
          <p className="mt-3 font-mono text-sm text-subtle">
            Reference: {error.digest}
          </p>
        ) : null}
      </MessagePage>
    </BarePage>
  );
}
