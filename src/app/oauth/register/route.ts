/**
 * Dynamic Client Registration (RFC 7591), kept for assistants that don't yet
 * use Client ID Metadata Documents. Only public clients are accepted: they
 * authenticate with PKCE, not a secret.
 *
 *   POST /oauth/register { client_name, redirect_uris, … } → 201 { client_id, … }.
 */

import { oauthSweeps, saveClient } from '@/domain/db/oauth';
import { readBodyText } from '@/lib/core/api';
import {
  MAX_REGISTRATION_BYTES,
  clientAddress,
  handleRegistration,
  noStoreJson,
  oauthError,
  preflight,
  sweepSometimes,
  tooManyRequests,
} from '@/lib/oauth';
import { D1RateLimitStore } from '@/lib/rate-limit';
import { runInBackground } from '@/lib/core/runtime';
import { getDatabase } from '@/domain/db/client';

/**
 * `POST /oauth/register`: register a public client from a JSON body. Anyone
 * may call it, up to a limit per address. Answers 201 with the new `client_id`
 * and its details, 429 (with `Retry-After`) when the address has registered too
 * much lately, or 400 with an OAuth error for a body that is too large (the
 * body is read only up to the cap), not JSON, or not an acceptable client.
 */
export async function POST(request: Request) {
  const db = getDatabase();
  const now = Math.floor(Date.now() / 1000);
  const result = await handleRegistration(
    () => readBodyText(request, MAX_REGISTRATION_BYTES),
    clientAddress(request.headers),
    {
      rateLimits: new D1RateLimitStore(db.$client),
      save: (client) => saveClient(db, client),
      now,
    },
  );
  sweepSometimes(oauthSweeps(db), runInBackground);
  if (result.ok) {
    return noStoreJson(result.body, 201);
  }
  return result.limited
    ? tooManyRequests(result.retryAfter, 'register')
    : oauthError(result.error, result.description);
}

/** `OPTIONS /oauth/register`: the CORS preflight for browser-based assistants. Answers 204. */
export function OPTIONS() {
  return preflight();
}
