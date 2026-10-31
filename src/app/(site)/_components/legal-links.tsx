import Link from 'next/link';
import type { ReactElement } from 'react';

/** How each link looks: underlined, in the text's own colour. */
const LINK =
  'focus-ring rounded-control underline underline-offset-2 hover:text-ink';

/**
 * The privacy policy and the terms, as one quiet line. The paper has no
 * footer, so this sits in the front page's colophon and under the sign-in
 * button, where Google and the people signing in look for them.
 */
export function LegalLinks(): ReactElement {
  return (
    <nav aria-label="Legal" className="mt-2">
      <Link href="/privacy" className={LINK}>
        Privacy
      </Link>
      {' · '}
      <Link href="/terms" className={LINK}>
        Terms
      </Link>
    </nav>
  );
}
