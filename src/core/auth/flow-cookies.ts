/**
 * @packageDocumentation
 *
 * The two short-lived cookies a Google round trip leaves in the browser, and
 * how they are put out and taken away: the one-time `state` (the CSRF check the
 * callback makes) and the path to return to afterwards.
 */

import { NextResponse } from 'next/server';

import { RETURN_COOKIE, STATE_COOKIE } from '@/domain/auth/app';
import { STATE_TTL_SECONDS } from '@/lib/web-security';

/** What the round trip needs remembered. */
export interface FlowStart {
  /** The one-time `state` sent to Google. */
  readonly state: string;
  /** The safe site path to land on afterwards, if there is one. */
  readonly returnTo: string | undefined;
  /** Whether the site is served over https (cookies are then `Secure`). */
  readonly secure: boolean;
}

/**
 * Remember a round trip on `response`: the `state` for the callback to check,
 * and where to land after. Without a `returnTo`, an older one is cleared, so
 * an abandoned earlier attempt cannot send them somewhere stale.
 */
export function startFlowCookies(
  response: NextResponse,
  { state, returnTo, secure }: FlowStart,
): void {
  const options = {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: STATE_TTL_SECONDS,
  } as const;
  response.cookies.set(STATE_COOKIE, state, options);
  if (returnTo) {
    response.cookies.set(RETURN_COOKIE, returnTo, options);
  } else {
    response.cookies.delete(RETURN_COOKIE);
  }
}

/** Send the browser on to `path` on this site, with both one-time cookies cleared. */
export function finishFlow(origin: string, path: string): NextResponse {
  const response = NextResponse.redirect(`${origin}${path}`);
  response.cookies.delete(RETURN_COOKIE);
  response.cookies.delete(STATE_COOKIE);
  return response;
}
