/**
 * @packageDocumentation
 *
 * Who is calling the REST API. The browser app authenticates with its signed
 * session cookie. Because a cookie is sent automatically, requests that change
 * data must also come from our own pages: the browser reports where a request
 * came from in `Sec-Fetch-Site`, and anything not same-origin is refused.
 *
 * Identity is resolved from the request through a {@link CurrentUserResolver}
 * port, so the credential source (today the signed session cookie) lives in one
 * place and is swappable without touching the controllers. The RSC pages read
 * identity a different way (see `lib/core/auth/current-user`); this is the
 * controller-side resolver.
 */

import {
  SessionTokens,
  sessionIsCurrent,
  type SessionPayload,
} from '@/lib/session';
import { SESSION_COOKIE } from '@/domain/auth/app';
import { getSessionEpoch, getUserById } from '@/domain/auth/store';
import type { User } from '@/domain/repository';
import { isSameOriginPost } from '@/lib/web-security';
import { appOrigin } from '@/lib/core/origin';
import { getEnv } from '@/lib/core/runtime';
import { problems } from '@/lib/core/api';

/** Methods that never change data and so need no origin check. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Refuse cross-site requests that would change data. */
function crossSite(request: Request): boolean {
  return (
    !SAFE_METHODS.has(request.method) &&
    !isSameOriginPost(request.headers, appOrigin(request))
  );
}

/**
 * Resolves who is calling the REST API, from the request itself. The one place
 * the credential source lives, so it can be swapped (a bearer token, a header)
 * without touching the controllers.
 */
export interface CurrentUserResolver {
  /** The caller's id from the cookie alone, no database read; null when not signed in. */
  currentUid(request: Request): Promise<number | null>;
  /** Like {@link currentUid}, but confirms the session was not ended and the account exists. */
  currentLiveUid(request: Request): Promise<number | null>;
  /** The caller's full user record, or null. */
  currentUser(request: Request): Promise<User | null>;
}

/** Read one cookie's value from a request's `Cookie` header. */
function cookieValue(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie');
  if (!header) {
    return undefined;
  }
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq !== -1 && part.slice(0, eq).trim() === name) {
      return part.slice(eq + 1).trim();
    }
  }
  return undefined;
}

/** The signed session claims on a request, or null when there is no trustworthy cookie. */
async function sessionOf(request: Request): Promise<SessionPayload | null> {
  const token = cookieValue(request, SESSION_COOKIE);
  const secret = getEnv().SESSION_SECRET;
  if (!token || !secret) {
    return null;
  }
  return new SessionTokens(secret).verify(token);
}

/**
 * The production resolver: identity from the signed session cookie on the
 * request. Mirrors the checks the RSC-side `current-user` makes, but reads the
 * cookie off the request rather than the ambient request scope.
 */
export const requestCookieResolver: CurrentUserResolver = {
  async currentUid(request) {
    return (await sessionOf(request))?.uid ?? null;
  },
  async currentLiveUid(request) {
    const session = await sessionOf(request);
    if (!session) {
      return null;
    }
    const epoch = await getSessionEpoch(session.uid);
    return epoch !== undefined && sessionIsCurrent(session, epoch)
      ? session.uid
      : null;
  },
  async currentUser(request) {
    const session = await sessionOf(request);
    if (!session) {
      return null;
    }
    const user = await getUserById(session.uid);
    return user && sessionIsCurrent(session, user.session_epoch) ? user : null;
  },
};

/** Success carries the caller; failure carries the response to send back. */
export type Auth<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly response: Response };

/**
 * Run the cross-site check, then `identify`: 403 for a cross-site write, 401
 * when `identify` finds nobody (it answers null), otherwise the caller. The
 * 403 comes first so a forged request learns nothing about who is signed in.
 */
async function authenticate<T>(
  request: Request,
  identify: () => Promise<T | null>,
): Promise<Auth<T>> {
  if (crossSite(request)) {
    return {
      ok: false,
      response: problems.forbidden('Cross-site requests are not allowed.'),
    };
  }
  const caller = await identify();
  return caller === null
    ? { ok: false, response: problems.unauthorized() }
    : { ok: true, value: caller };
}

/**
 * The caller's user id, from the signed cookie alone (no database read).
 * Enough for anything that only scopes queries by user, but it cannot tell that
 * the person has since signed out everywhere: use {@link requireLiveUid} (or
 * {@link requireUser}) wherever that matters.
 */
export async function requireUid(
  request: Request,
  resolver: CurrentUserResolver = requestCookieResolver,
): Promise<Auth<number>> {
  return authenticate(request, () => resolver.currentUid(request));
}

/**
 * The caller's user id, after confirming with one small database read that the
 * session has not been ended and the account still exists. For routes that
 * only need the id but must honour "sign out everywhere".
 */
export async function requireLiveUid(
  request: Request,
  resolver: CurrentUserResolver = requestCookieResolver,
): Promise<Auth<number>> {
  return authenticate(request, () => resolver.currentLiveUid(request));
}

/** The caller's full user record, for routes that need Drive access. */
export async function requireUser(
  request: Request,
  resolver: CurrentUserResolver = requestCookieResolver,
): Promise<Auth<User>> {
  return authenticate(request, () => resolver.currentUser(request));
}

/** The value of an {@link Auth}, or the refusal thrown as a problem `Response` (for controllers). */
function orThrow<T>(auth: Auth<T>): T {
  if (!auth.ok) {
    throw auth.response;
  }
  return auth.value;
}

/** Like {@link requireLiveUid}, but throws the refusal — for an {@link ApiController} context. */
export async function liveUid(
  request: Request,
  resolver: CurrentUserResolver = requestCookieResolver,
): Promise<number> {
  return orThrow(await requireLiveUid(request, resolver));
}

/** Like {@link requireUser}, but throws the refusal — for an {@link ApiController} context. */
export async function sessionUser(
  request: Request,
  resolver: CurrentUserResolver = requestCookieResolver,
): Promise<User> {
  return orThrow(await requireUser(request, resolver));
}
