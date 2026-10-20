import type { ReactElement } from 'react';

/**
 * The first thing a keyboard user reaches: a link that jumps past the header to
 * the page's `<main id="main">`. It is out of sight until it has focus.
 */
export function SkipLink(): ReactElement {
  return (
    <a
      href="#main"
      className="sr-only z-50 bg-ink px-4 py-2 text-sm font-semibold text-on-ink focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:rounded-control"
    >
      Skip to content
    </a>
  );
}
