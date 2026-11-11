/**
 * The token endpoint: an authorization code (with its PKCE verifier) or a
 * refresh token, for a new access and refresh token.
 *
 * POST /oauth/token (application/x-www-form-urlencoded).
 */

import { D1OAuthStore } from '@/domain/db/oauth';
import { getDatabase } from '@/domain/db/database';
import {
  formFailure,
  handleTokenRequest,
  noStoreJson,
  oauthError,
  preflight,
  readOAuthForm,
} from '@/lib/oauth';
import { appOrigin } from '@/lib/core/origin';

/**
 * `POST /oauth/token`: 200 with the tokens (never cached), or 400 with an
 * OAuth error for a missing or bad code, verifier, refresh token or form.
 */
export async function POST(request: Request) {
  const body = await readOAuthForm(request);
  if (body.kind !== 'ok') {
    return formFailure(body);
  }
  const result = await handleTokenRequest(
    body.form,
    new D1OAuthStore(getDatabase()),
    appOrigin(request),
    Math.floor(Date.now() / 1000),
  );
  return result.ok
    ? noStoreJson(result.tokens)
    : oauthError(result.error, result.description);
}

/** `OPTIONS /oauth/token`: the CORS preflight. 204. */
export function OPTIONS() {
  return preflight();
}
