import type { ReactElement } from 'react';

/**
 * The first thing a keyboard user reaches: a link that jumps past the header to
 * the page's `<main id="main">`. It is out of sight until it has focus.
 */
export function SkipLink(): ReactElement {
  return (
    <a
      href="#main"
      className="fixed -top-20 left-2 z-50 rounded-control bg-ink px-4 py-2 text-sm font-semibold text-on-ink focus:top-2"
    >
      Skip to content
    </a>
  );
}
