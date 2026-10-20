/**
 * @packageDocumentation
 *
 * Writing the signed session cookie onto a response, from a user record. Used
 * wherever the session is (re)issued: signing in, and any route that has to
 * bring the cookie's hints up to date.
 */

import type { NextResponse } from 'next/server';

import { sessionClaims } from './app';
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  createSessionToken,
} from './session';
import type { User } from './store';

/**
 * Set a fresh session cookie for `user` on `response`. `claims` replaces the
 * app's usual extra claims (see `sessionClaims` in `app.ts`), for the moment
 * something they report has just changed and `user` is the row from before.
 */
export async function setSessionCookie(
  response: NextResponse,
  user: Readonly<User>,
  options: Readonly<{
    secret: string;
    secure: boolean;
    claims?: Readonly<Record<string, string | number | boolean>>;
    /** Keep this expiry (Unix seconds) instead of starting a new 30 days. */
    exp?: number;
  }>,
): Promise<void> {
  const token = await createSessionToken(
    {
      ...(options.claims ?? sessionClaims(user)),
      uid: user.id,
      email: user.email,
      name: user.name ?? undefined,
      picture: user.picture ?? undefined,
      ep: user.session_epoch,
      exp: options.exp,
    },
    options.secret,
  );
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: options.secure,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}
