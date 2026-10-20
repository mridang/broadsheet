'use client';

import type { ReactElement } from 'react';

import { buttonClass } from '@/components/ui/button';

import { BRAND_NAME, ERROR_REASSURANCE } from './_brand';
import './globals.css';

/**
 * The last resort: shown when the root layout itself fails, so nothing else on
 * the page can be relied on. It stands alone, with its own document, the global
 * styles and plain markup (no shared components, and plain `<a>` and `<button>`
 * elements because there is no router), and falls back to system fonts because
 * the font loader lives in the layout that just failed. Only the look of the
 * two buttons is shared, through `buttonClass`, which is just a function that
 * returns class names.
 */
export default function GlobalError({
  error,
  unstable_retry,
}: Readonly<{
  /** What was thrown; Next adds a `digest` that matches the server log entry. */
  error: Error & { digest?: string };
  /** Asks Next to render the whole app again. */
  unstable_retry: () => void;
}>): ReactElement {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-paper font-sans text-ink">
        <title>{`Something went wrong · ${BRAND_NAME}`}</title>
        <div className="h-1.5 bg-brand" />
        <main
          id="main"
          className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-4 py-16 sm:px-6"
        >
          <p className="text-label font-semibold text-accent uppercase">
            Something went wrong
          </p>
          <h1 className="mt-3 text-4xl leading-tight font-bold tracking-tight sm:text-5xl">
            That didn&apos;t work
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-muted">
            {BRAND_NAME} hit a problem it could not recover from.{' '}
            {ERROR_REASSURANCE}
          </p>
          {error.digest ? (
            <p className="mt-3 font-mono text-sm text-subtle">
              Reference: {error.digest}
            </p>
          ) : null}
          <div className="mt-8 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => unstable_retry()}
              className={buttonClass({ size: 'lg' })}
            >
              Try again
            </button>
            {/* A plain link: this page has no router to rely on. */}
            <a
              href="/"
              className={buttonClass({ variant: 'outline', size: 'lg' })}
            >
              Back to the home page
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
