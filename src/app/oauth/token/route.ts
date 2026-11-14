/**
 * The token endpoint. Redeems an authorization code (with its PKCE verifier)
 * for an access + refresh token, or exchanges a refresh token for a new pair.
 *
 *   POST /oauth/token  (application/x-www-form-urlencoded).
 */

import { D1OAuthStore, oauthSweeps } from '@/domain/db/oauth';
import {
  OAUTH_LIMITS,
  clientAddress,
  formFailure,
  handleTokenRequest,
  noStoreJson,
  oauthError,
  preflight,
  readOAuthForm,
  retryAfterIfLimited,
  sweepSometimes,
  tooManyRequests,
} from '@/lib/oauth';
import { D1RateLimitStore } from '@/lib/rate-limit';
import { runInBackground } from '@/lib/core/runtime';
import { getDatabase } from '@/domain/db/client';
import { appOrigin } from '@/lib/core/origin';

/**
 * `POST /oauth/token`: trade an authorization code (`grant_type=
 * authorization_code`) or a refresh token (`grant_type=refresh_token`) for a
 * new access and refresh token. Anyone may call it, up to a generous limit per
 * address; the code, verifier and client decide whether it works. Answers 200
 * with the tokens (never cached), 429 (with `Retry-After`) over the limit, 401
 * (with a `WWW-Authenticate` challenge) for a request that tried to identify
 * itself with an `Authorization: Basic` header instead of `client_id`, and 400
 * with an OAuth error for anything else, including a missing `client_id` or
 * `grant_type`, a form that is not URL-encoded and a body over 16 KiB.
 */
export async function POST(request: Request) {
  const db = getDatabase();
  const now = Math.floor(Date.now() / 1000);
  const wait = await retryAfterIfLimited(
    new D1RateLimitStore(db.$client),
    OAUTH_LIMITS.token,
    clientAddress(request.headers),
    now,
  );
  if (wait !== undefined) {
    return tooManyRequests(wait, 'token');
  }
  const body = await readOAuthForm(request);
  if (body.kind !== 'ok') {
    return formFailure(body);
  }
  const result = await handleTokenRequest(
    body.form,
    new D1OAuthStore(db),
    appOrigin(request),
    now,
    {
      basicAuthAttempted: /^basic\s/i.test(
        request.headers.get('authorization') ?? '',
      ),
    },
  );
  sweepSometimes(oauthSweeps(db), runInBackground);
  if (result.ok) {
    return noStoreJson(result.tokens);
  }
  return oauthError(
    result.error,
    result.description,
    result.status,
    result.wwwAuthenticate
      ? { 'WWW-Authenticate': result.wwwAuthenticate }
      : {},
  );
}

/** `OPTIONS /oauth/token`: the CORS preflight for browser-based assistants. Answers 204. */
export function OPTIONS() {
  return preflight();
}
