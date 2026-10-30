/**
 * @packageDocumentation
 *
 * Server-side helpers to resolve the signed-in user. Used by Server Components
 * (the pages behind sign-in) and by the API routes. Identity comes from the
 * signed session cookie; with no `SESSION_SECRET` no cookie can be trusted, so
 * nobody is signed in.
 */

import { cookies } from 'next/headers';

import { SESSION_COOKIE } from '@/domain/auth/app';
import {
  SessionTokens,
  sessionIsCurrent,
  type SessionPayload,
} from '@/lib/session';
import { getSessionEpoch, getUserById, type User } from '@/domain/auth/store';
import { setErrorContext } from '@/lib/core/observability/context';
import { getEnv } from '@/lib/core/runtime';

/**
 * The user for the current request, or null when not signed in, the session is
 * invalid or expired, or it was ended (the person signed out everywhere, or the
 * account is gone). Verifies the cookie signature before touching the DB.
 */
export async function getCurrentUser(): Promise<User | null> {
  const payload = await getSession();
  if (!payload) {
    return null;
  }
  const user = await getUserById(payload.uid);
  return user && sessionIsCurrent(payload, user.session_epoch) ? user : null;
}

/**
 * The signed session claims straight from the cookie, with **no database
 * read**. The cookie is HMAC-signed, so a valid one can be trusted for identity;
 * callers that only scope queries by user id (like the recipe page) can skip
 * the `users` lookup entirely and save a network round trip to D1. Any extra
 * claims an app adds are only hints: check the database before relying on them.
 * Null when there is no cookie, it does not verify, or there is no secret to
 * verify it with.
 */
export async function getSession(): Promise<SessionPayload | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const secret = getEnv().SESSION_SECRET;
  if (!token || !secret) {
    return null;
  }
  const payload = await new SessionTokens(secret).verify(token);
  if (payload) {
    // Only the internal number: an error in this request shows who it was for.
    await setErrorContext({ 'user.id': payload.uid, 'auth.method': 'session' });
  }
  return payload;
}

/**
 * The signed-in user's id from the session cookie alone (see {@link getSession}).
 * Because nothing is read from the database, a session the person has since
 * ended (signed out everywhere) is still accepted here until it expires: use
 * {@link getLiveSessionUid} for anything that changes data or hands out secrets.
 */
export async function getSessionUid(): Promise<number | null> {
  return (await getSession())?.uid ?? null;
}

/**
 * Like {@link getSessionUid}, but also confirms with one small database read
 * that the session has not been ended and the account still exists. Null in
 * either case.
 */
export async function getLiveSessionUid(): Promise<number | null> {
  const session = await getSession();
  if (!session) {
    return null;
  }
  const epoch = await getSessionEpoch(session.uid);
  return epoch !== undefined && sessionIsCurrent(session, epoch)
    ? session.uid
    : null;
}
