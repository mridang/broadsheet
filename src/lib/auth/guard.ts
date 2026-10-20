/**
 * @packageDocumentation
 *
 * Who is calling the sign-out routes. The browser app authenticates with its
 * signed session cookie. Because a cookie is sent automatically, a request that
 * changes anything must also come from our own pages: the browser reports where
 * a request came from in `Sec-Fetch-Site`, and anything not same-origin is
 * refused. Refusals are RFC 9457 problem documents.
 */

import { NextResponse } from 'next/server';

import { appOrigin } from '../util/origin';
import { isSameOriginPost } from './csrf';
import { getCurrentUser } from './current-user';
import type { User } from './store';

/** A problem response with the fixed shape every refusal here has. */
function refusal(
  status: 401 | 403,
  type: string,
  title: string,
  detail: string,
): NextResponse {
  return NextResponse.json(
    { type, title, status, detail },
    {
      status,
      headers: {
        'Content-Type': 'application/problem+json',
        'Cache-Control': 'no-store',
      },
    },
  );
}

/**
 * The refusal for a request made from another site, or undefined when it came
 * from our own pages. Signing someone out from another site is a nuisance
 * attack, so it is checked before anything about who is signed in is revealed.
 */
export function crossSiteRefusal(request: Request): NextResponse | undefined {
  return isSameOriginPost(request.headers, appOrigin(request))
    ? undefined
    : refusal(
        403,
        '/problems/forbidden',
        'Forbidden',
        'Cross-site requests are not allowed.',
      );
}

/** Success carries the caller; failure carries the response to send back. */
export type Caller =
  | { readonly ok: true; readonly user: User }
  | { readonly ok: false; readonly response: NextResponse };

/**
 * The signed-in person for a request that changes something: 403 for a request
 * from another site, 401 when nobody is signed in or the session has been
 * ended, otherwise the person.
 */
export async function requireSignedIn(request: Request): Promise<Caller> {
  const refused = crossSiteRefusal(request);
  if (refused) {
    return { ok: false, response: refused };
  }
  const user = await getCurrentUser();
  return user
    ? { ok: true, user }
    : {
        ok: false,
        response: refusal(
          401,
          '/problems/unauthorized',
          'Unauthorized',
          'Sign in first.',
        ),
      };
}
