import type { ReactElement } from 'react';

/**
 * The first thing a keyboard user reaches: a link that jumps past the header to
 * the page's `<main id="main">`. It is out of sight until it has focus.
 */
export function SkipLink(): ReactElement {
  return (
    // eslint-disable-next-line github/a11y-no-visually-hidden-interactive-element -- the rule does not recognise `focus:not-sr-only`, which reveals the link on focus; a translate-based hide passed the rule but swapped the sr-only technique the skip-link test and the app rely on
    <a
      href="#main"
      className="sr-only z-50 bg-ink px-4 py-2 text-sm font-semibold text-on-ink focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:rounded-control"
    >
      Skip to content
    </a>
  );
}
