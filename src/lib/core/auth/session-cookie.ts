/**
 * @packageDocumentation
 *
 * Writing the signed session cookie onto a response, from a user record. Used
 * wherever the session is (re)issued: signing in, and any route that has to
 * bring the cookie's hints up to date.
 */

import type { NextResponse } from 'next/server';

import { SESSION_COOKIE, sessionClaims } from '@/domain/auth/app';
import { SESSION_TTL_SECONDS, SessionTokens } from '@/lib/session';
import type { User } from '@/domain/auth/store';

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
  const token = await new SessionTokens(options.secret).create({
    ...(options.claims ?? sessionClaims(user)),
    uid: user.id,
    email: user.email,
    name: user.name ?? undefined,
    picture: user.picture ?? undefined,
    ep: user.session_epoch,
    exp: options.exp,
  });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: options.secure,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}
