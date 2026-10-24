/**
 * Google's way back into the app.
 *
 * Signing in: validates the `state`, exchanges the code, loads the identity,
 * records the user, issues the session cookie and sends them on (to the app's
 * landing page unless they came from somewhere specific). An app can have other
 * asks that come back the same way (see `EXTRA_PURPOSES` in `app.ts`); the
 * `state` says which one this was, and the app's own flow (see `hooks.ts`)
 * finishes it. Any failure sends them back with a fixed flag rather than
 * leaking details.
 *
 * The behaviour lives in the app's sign-in kit; this file only mounts it.
 */

import { authKit } from '@/domain/auth/kit';

export const GET = authKit.callbackHandler();
