/**
 * @packageDocumentation
 *
 * What the shared sign-in code (`google-oauth`, `oauth-state`, `return-to`,
 * `flow-cookies`, `session`, `session-cookie`, `sign-in`, and the login,
 * callback and sessions routes) needs to know about this app: the names of its
 * cookies, where people land, which extra asks a Google round trip can be
 * for, and what its session cookie carries beyond who the person is. The other
 * per-app modules are `store.ts` (the users table) and `hooks.ts` (what
 * happens after sign-in). Every app has these three, with the same exports.
 */

import type { User } from '../repository';

/** Name of the session cookie. */
export const SESSION_COOKIE = 'broadsheet_session';

/** Name of the short-lived cookie holding the OAuth `state` value. */
export const STATE_COOKIE = 'broadsheet_oauth_state';

/** Short-lived cookie holding the path to return to after Google sign-in. */
export const RETURN_COOKIE = 'broadsheet_return_to';

/** Where someone lands after signing in, unless they came from somewhere specific. */
export const LANDING_PATH = '/feeds';

/** Where someone lands when signing in failed, with a fixed flag rather than any detail. */
export const SIGN_IN_FAILED_PATH = '/login?error=auth';

/** The asks a Google round trip can be for besides signing in. This app has none. */
export const EXTRA_PURPOSES: readonly string[] = [];

/**
 * The claims this app's session cookie carries besides who the person is. None:
 * everything else is read from the database.
 */
export const sessionClaims: (
  user: Readonly<User>,
) => Readonly<Record<string, string | boolean>> = () => ({});
