/**
 * @packageDocumentation
 *
 * Dynamic Client Registration (RFC 7591) for public clients: an assistant
 * names itself and its redirect URIs and gets a `client_id`. There is no
 * secret; the client proves itself with PKCE on every authorization.
 */

import { z } from 'zod';

import { isAcceptableRedirectUri } from './redirect-uri';
import type { OAuthClient, OAuthStore } from './store';

/** The most a registration body may weigh. */
export const MAX_REGISTRATION_BYTES = 16_384;

/** The members of a registration this server reads; others are ignored. */
const Registration = z.object({
  client_name: z.string().trim().min(1).max(200).optional(),
  redirect_uris: z.array(z.string()).min(1).max(10),
  token_endpoint_auth_method: z.literal('none').optional(),
  grant_types: z
    .array(z.enum(['authorization_code', 'refresh_token']))
    .optional(),
  response_types: z.array(z.literal('code')).optional(),
});

/** What a registration came to: the client's details, or an OAuth error. */
export type RegistrationResult =
  | { readonly ok: true; readonly body: Record<string, unknown> }
  | {
      readonly ok: false;
      readonly error: string;
      readonly description: string;
    };

/** Register the client a parsed JSON body describes. */
export async function registerClient(
  body: unknown,
  store: Pick<OAuthStore, 'saveClient'>,
  now: number,
): Promise<RegistrationResult> {
  const parsed = Registration.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_client_metadata',
      description:
        'Send redirect_uris, and only token_endpoint_auth_method "none" with the code and refresh_token grants.',
    };
  }
  const { redirect_uris: uris } = parsed.data;
  const refused = uris.find((uri) => !isAcceptableRedirectUri(uri));
  if (refused !== undefined) {
    return {
      ok: false,
      error: 'invalid_redirect_uri',
      description:
        'Redirect URIs must be https, http on localhost, or a reverse-domain app scheme, with no fragment.',
    };
  }
  const client: OAuthClient = {
    clientId: crypto.randomUUID(),
    name: parsed.data.client_name ?? 'An unnamed app',
    redirectUris: uris,
  };
  await store.saveClient(client);
  return {
    ok: true,
    body: {
      client_id: client.clientId,
      client_id_issued_at: now,
      client_name: client.name,
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
  };
}
