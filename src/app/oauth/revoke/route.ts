/**
 * Token revocation (RFC 7009). Ends the grant the token belongs to, so the
 * access and refresh tokens stop working together. Answers 200 whether or not
 * the token was known, so it can't be used to probe for valid tokens.
 */

import { D1OAuthStore } from '@/domain/db/oauth';
import {
  OAUTH_LIMITS,
  clientAddress,
  formFailure,
  formField,
  noStoreJson,
  oauthError,
  preflight,
  readOAuthForm,
  retryAfterIfLimited,
  revokeToken,
  tooManyRequests,
} from '@/lib/oauth';
import { D1RateLimitStore } from '@/lib/rate-limit';
import { getDatabase } from '@/domain/db/client';

/**
 * `POST /oauth/revoke`: revoke the grant behind `token` (a URL-encoded form
 * field). Anyone holding a token may call it, up to a generous limit per
 * address, since each call is a database lookup. Answers 200 with `{}` whether
 * or not the token was known, 429 (with `Retry-After`) over the limit, or 400
 * when the `token` field is missing, the body is not a URL-encoded form or it
 * is over 16 KiB.
 */
export async function POST(request: Request) {
  const db = getDatabase();
  const wait = await retryAfterIfLimited(
    new D1RateLimitStore(db.$client),
    OAUTH_LIMITS.revoke,
    clientAddress(request.headers),
  );
  if (wait !== undefined) {
    return tooManyRequests(wait, 'revoke');
  }
  const body = await readOAuthForm(request);
  if (body.kind !== 'ok') {
    return formFailure(body);
  }
  const token = formField(body.form, 'token');
  if (!token) {
    return oauthError('invalid_request', 'The request has no token.');
  }
  await revokeToken(new D1OAuthStore(db), token);
  return noStoreJson({});
}

/** `OPTIONS /oauth/revoke`: the CORS preflight for browser-based assistants. Answers 204. */
export function OPTIONS() {
  return preflight();
}
