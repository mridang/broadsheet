'use client';

import type { ReactElement } from 'react';

import { MENU_ITEM } from '@/components/ui/menu';

/**
 * Signs the person out: ends the session on the server, then goes to the front
 * page whether or not that request succeeded (a failed request must not leave
 * them stuck on a page that thinks they are still signed in).
 */
async function signOut(): Promise<void> {
  try {
    await fetch('/api/sessions/self', { method: 'DELETE' });
  } catch {
    // Nothing to do about it here: the front page below shows what is true.
  }
  globalThis.window.location.assign('/');
}

/** "Sign out", the last item of the account menu in the top bar. */
export function SignOutButton(): ReactElement {
  return (
    <button type="button" className={MENU_ITEM} onClick={() => void signOut()}>
      Sign out
    </button>
  );
}
