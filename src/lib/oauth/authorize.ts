/**
 * @packageDocumentation
 *
 * Checking an authorization request (OAuth 2.1 §4.1.1) and minting the code
 * once the person approves. The approval screen and the consent endpoint both
 * run the same check, since the form fields are untrusted.
 *
 * A problem with the client or its redirect URI is shown to the person and
 * never sent to the redirect URI (that would make this site an open
 * redirector). Any later problem goes back to the verified redirect URI.
 */

import { isOurResource, resourceUri } from './metadata';
import { isWellFormedChallenge } from './pkce';
import { matchesRegistered } from './redirect-uri';
import { normaliseScope } from './scopes';
import { CODE_PREFIX, hashSecret, newSecret } from './secrets';
import type { OAuthClient, OAuthStore } from './store';

/** The query (or form) parameters of an authorization request. */
export type AuthorizeParams = Readonly<Record<string, string | undefined>>;

/** The parameters the approval form carries on to the consent endpoint. */
export const AUTHORIZE_FIELDS = [
  'response_type',
  'client_id',
  'redirect_uri',
  'state',
  'scope',
  'code_challenge',
  'code_challenge_method',
  'resource',
] as const;

/** A request that passed every check. */
export interface AuthorizeRequest {
  readonly client: OAuthClient;
  readonly redirectUri: string;
  readonly state: string | undefined;
  readonly codeChallenge: string;
  readonly scope: readonly string[];
  readonly resource: string;
}

/** The outcome of checking a request. */
export type AuthorizeCheck =
  | { readonly ok: true; readonly request: AuthorizeRequest }
  | {
      readonly ok: false;
      readonly error: string;
      readonly description: string;
      /** Where to report the error, once the redirect URI is verified. */
      readonly redirect?: { readonly uri: string; readonly state?: string };
    };

/** The parameters of a form or query as {@link AuthorizeParams}. */
export function authorizeParamsFrom(
  fields: Readonly<{ get(name: string): string | null }>,
): AuthorizeParams {
  return Object.fromEntries(
    AUTHORIZE_FIELDS.map((name) => [name, fields.get(name) ?? undefined]),
  );
}

/** Check an authorization request against the registered client. */
export async function validateAuthorizeRequest(
  params: AuthorizeParams,
  origin: string,
  findClient: (id: string) => Promise<OAuthClient | undefined>,
): Promise<AuthorizeCheck> {
  const clientId = params['client_id'];
  const client = clientId ? await findClient(clientId) : undefined;
  if (!client) {
    return {
      ok: false,
      error: 'invalid_client',
      description: 'This app is not registered here.',
    };
  }
  const sent = params['redirect_uri'];
  const redirectUri =
    sent ??
    (client.redirectUris.length === 1 ? client.redirectUris[0] : undefined);
  if (!redirectUri || !matchesRegistered(redirectUri, client.redirectUris)) {
    return {
      ok: false,
      error: 'invalid_request',
      description: 'The redirect URI is not one this app registered.',
    };
  }
  const state = params['state'];
  const refuse = (error: string, description: string): AuthorizeCheck => ({
    ok: false,
    error,
    description,
    redirect: { uri: redirectUri, ...(state ? { state } : {}) },
  });
  if (params['response_type'] !== 'code') {
    return refuse('unsupported_response_type', 'Only response_type=code.');
  }
  const challenge = params['code_challenge'] ?? '';
  if (
    !isWellFormedChallenge(challenge) ||
    params['code_challenge_method'] !== 'S256'
  ) {
    return refuse('invalid_request', 'PKCE with S256 is required.');
  }
  const resource = params['resource'];
  if (resource !== undefined && !isOurResource(resource, origin)) {
    return refuse('invalid_target', 'The resource is not this MCP server.');
  }
  return {
    ok: true,
    request: {
      client,
      redirectUri,
      state,
      codeChallenge: challenge,
      scope: normaliseScope(params['scope']),
      resource: resourceUri(origin),
    },
  };
}

/** How long an authorization code may wait to be redeemed, in seconds. */
export const CODE_LIFETIME = 60;

/** Mint and store a single-use code for an approved request. */
export async function issueAuthorizationCode(
  store: Pick<OAuthStore, 'saveCode'>,
  request: AuthorizeRequest,
  userId: number,
  now: number,
): Promise<string> {
  const code = newSecret(CODE_PREFIX);
  await store.saveCode({
    codeHash: await hashSecret(code),
    clientId: request.client.clientId,
    userId,
    redirectUri: request.redirectUri,
    codeChallenge: request.codeChallenge,
    scope: request.scope,
    resource: request.resource,
    expiresAt: now + CODE_LIFETIME,
  });
  return code;
}
