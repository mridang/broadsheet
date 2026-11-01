/**
 * @packageDocumentation
 *
 * The token endpoint (OAuth 2.1 §3.2) and checking the tokens it issues.
 * A code is traded once, with its PKCE verifier, for an access token and a
 * refresh token under a new grant; a refresh token is traded once for a new
 * pair (rotation), so a stolen one stops working as soon as either side uses
 * it. Revoking a grant ends every token issued under it.
 */

import { verifyPkce } from './pkce';
import {
  ACCESS_PREFIX,
  REFRESH_PREFIX,
  hashSecret,
  newSecret,
} from './secrets';
import { isOurResource } from './metadata';
import type { OAuthStore, StoredGrant } from './store';

/** How long an access token lasts, in seconds. */
export const ACCESS_LIFETIME = 60 * 60;
/** How long a refresh token lasts, in seconds. */
export const REFRESH_LIFETIME = 60 * 60 * 24 * 30;

/** A successful token response (RFC 6749 §5.1). */
export interface TokenResponse {
  readonly access_token: string;
  readonly token_type: 'Bearer';
  readonly expires_in: number;
  readonly refresh_token: string;
  readonly scope: string;
}

/** What a token request came to. */
export type TokenResult =
  | { readonly ok: true; readonly tokens: TokenResponse }
  | {
      readonly ok: false;
      readonly error: string;
      readonly description: string;
    };

/** A failed token request. */
const fail = (error: string, description: string): TokenResult => ({
  ok: false,
  error,
  description,
});

/** Issue a fresh access and refresh token under a grant. */
async function issuePair(
  store: OAuthStore,
  grant: Pick<StoredGrant, 'id' | 'scope'>,
  now: number,
): Promise<TokenResponse> {
  const access = newSecret(ACCESS_PREFIX);
  const refresh = newSecret(REFRESH_PREFIX);
  await store.saveToken({
    tokenHash: await hashSecret(access),
    kind: 'access',
    grantId: grant.id,
    expiresAt: now + ACCESS_LIFETIME,
  });
  await store.saveToken({
    tokenHash: await hashSecret(refresh),
    kind: 'refresh',
    grantId: grant.id,
    expiresAt: now + REFRESH_LIFETIME,
  });
  return {
    access_token: access,
    token_type: 'Bearer',
    expires_in: ACCESS_LIFETIME,
    refresh_token: refresh,
    scope: grant.scope.join(' '),
  };
}

/** Trade an authorization code for tokens. */
async function redeemCode(
  form: URLSearchParams,
  store: OAuthStore,
  origin: string,
  now: number,
): Promise<TokenResult> {
  const code = form.get('code');
  const verifier = form.get('code_verifier');
  if (!code || !verifier) {
    return fail('invalid_request', 'Send code and code_verifier.');
  }
  const stored = await store.takeCode(await hashSecret(code));
  const clientId = form.get('client_id');
  const redirectUri = form.get('redirect_uri');
  const resource = form.get('resource');
  if (
    !stored ||
    stored.expiresAt <= now ||
    stored.clientId !== clientId ||
    (redirectUri !== null && redirectUri !== stored.redirectUri) ||
    (resource !== null && !isOurResource(resource, origin)) ||
    !(await verifyPkce(verifier, stored.codeChallenge))
  ) {
    return fail('invalid_grant', 'The code is not valid.');
  }
  const grant = {
    id: crypto.randomUUID(),
    userId: stored.userId,
    clientId: stored.clientId,
    scope: stored.scope,
    resource: stored.resource,
  };
  await store.saveGrant(grant);
  return { ok: true, tokens: await issuePair(store, grant, now) };
}

/** Trade a refresh token for a new pair. */
async function refresh(
  form: URLSearchParams,
  store: OAuthStore,
  now: number,
): Promise<TokenResult> {
  const token = form.get('refresh_token');
  if (!token) {
    return fail('invalid_request', 'Send refresh_token.');
  }
  const stored = await store.takeToken(await hashSecret(token));
  const grant = stored ? await store.findGrant(stored.grantId) : undefined;
  if (
    !stored ||
    stored.kind !== 'refresh' ||
    stored.expiresAt <= now ||
    !grant ||
    grant.revoked ||
    grant.clientId !== form.get('client_id')
  ) {
    return fail('invalid_grant', 'The refresh token is not valid.');
  }
  return { ok: true, tokens: await issuePair(store, grant, now) };
}

/** Answer a token request from its URL-encoded form. */
export async function handleTokenRequest(
  form: URLSearchParams,
  store: OAuthStore,
  origin: string,
  now: number,
): Promise<TokenResult> {
  if (!form.get('client_id')) {
    return fail('invalid_request', 'Send client_id.');
  }
  switch (form.get('grant_type')) {
    case 'authorization_code':
      return redeemCode(form, store, origin, now);
    case 'refresh_token':
      return refresh(form, store, now);
    default:
      return fail(
        'unsupported_grant_type',
        'Use authorization_code or refresh_token.',
      );
  }
}

/** Who an access token speaks for. */
export interface AccessIdentity {
  readonly userId: number;
  readonly grantId: string;
  readonly scope: readonly string[];
}

/**
 * The grant behind an access token for `resource`, or undefined when the
 * token is unknown, expired, revoked, a refresh token, or for another server.
 */
export async function authenticateAccessToken(
  store: Pick<OAuthStore, 'findToken' | 'findGrant'>,
  token: string,
  resource: string,
  now: number,
): Promise<AccessIdentity | undefined> {
  const stored = await store.findToken(await hashSecret(token));
  if (!stored || stored.kind !== 'access' || stored.expiresAt <= now) {
    return undefined;
  }
  const grant = await store.findGrant(stored.grantId);
  if (!grant || grant.revoked || grant.resource !== resource) {
    return undefined;
  }
  return { userId: grant.userId, grantId: grant.id, scope: grant.scope };
}

/**
 * Revoke the grant behind a token (RFC 7009), only for the client it was
 * issued to. Unknown tokens, and another client's, are not an error, so the
 * answer never reveals whether a token existed.
 */
export async function revokeToken(
  store: Pick<OAuthStore, 'findToken' | 'findGrant' | 'revokeGrant'>,
  token: string,
  clientId: string,
): Promise<void> {
  const stored = await store.findToken(await hashSecret(token));
  const grant = stored ? await store.findGrant(stored.grantId) : undefined;
  if (grant && grant.clientId === clientId) {
    await store.revokeGrant(grant.id);
  }
}
