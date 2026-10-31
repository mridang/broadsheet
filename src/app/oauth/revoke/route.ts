/**
 * Token revocation (RFC 7009): revoking either token ends the grant behind
 * it, so the assistant is disconnected.
 *
 *   POST /oauth/revoke token=… (application/x-www-form-urlencoded)
 */

import { D1OAuthStore } from '@/domain/db/oauth';
import { getDatabase } from '@/domain/db/database';
import {
  formFailure,
  noStoreJson,
  oauthError,
  preflight,
  readOAuthForm,
  revokeToken,
} from '@/lib/oauth';

/**
 * `POST /oauth/revoke`: 200 whether or not the token was known (so the answer
 * reveals nothing), 400 for a form with no token.
 */
export async function POST(request: Request) {
  const body = await readOAuthForm(request);
  if (body.kind !== 'ok') {
    return formFailure(body);
  }
  const token = body.form.get('token');
  if (!token) {
    return oauthError('invalid_request', 'Send token.');
  }
  await revokeToken(new D1OAuthStore(getDatabase()), token);
  return noStoreJson({});
}

/** `OPTIONS /oauth/revoke`: the CORS preflight. 204. */
export function OPTIONS() {
  return preflight();
}
