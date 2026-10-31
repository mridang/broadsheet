/**
 * Dynamic Client Registration (RFC 7591) for public clients.
 *
 *   POST /oauth/register {client_name, redirect_uris} → 201 {client_id, …}
 */

import { D1OAuthStore } from '@/domain/db/oauth';
import { getDatabase } from '@/domain/db/database';
import { readJsonBody } from '@/lib/core/api';
import {
  MAX_REGISTRATION_BYTES,
  noStoreJson,
  oauthError,
  preflight,
  registerClient,
} from '@/lib/oauth';

/**
 * `POST /oauth/register`: register a public client. 201 with its
 * `client_id`, or 400 with an OAuth error for a body that is too large, not
 * JSON, or not an acceptable client.
 */
export async function POST(request: Request) {
  const body = await readJsonBody(request, MAX_REGISTRATION_BYTES);
  if (body.kind !== 'ok') {
    return oauthError('invalid_client_metadata', 'Send a JSON object.');
  }
  const result = await registerClient(
    body.value,
    new D1OAuthStore(getDatabase()),
    Math.floor(Date.now() / 1000),
  );
  return result.ok
    ? noStoreJson(result.body, 201)
    : oauthError(result.error, result.description);
}

/** `OPTIONS /oauth/register`: the CORS preflight. 204. */
export function OPTIONS() {
  return preflight();
}
