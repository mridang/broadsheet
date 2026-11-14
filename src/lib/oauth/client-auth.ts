/**
 * @packageDocumentation
 *
 * Client authentication at the token endpoint for clients that sign in with
 * `private_key_jwt` (RFC 7523, OpenID Connect Core §9). Such a client names a
 * `jwks_uri` in its metadata document; each token request then carries a
 * `client_assertion`, a JWT it signed with the matching private key. Checking
 * it proves the caller holds that key, so a stolen authorization code or refresh
 * token is of no use on its own. The signature and claim checks are `jose`'s;
 * what is decided here is what a valid assertion must say and that it is used
 * only once.
 */

import {
  createLocalJWKSet,
  decodeJwt,
  jwtVerify,
  type JSONWebKeySet,
} from 'jose';

import {
  ASSERTION_ALGORITHMS,
  FETCH_USER_AGENT,
  readCappedText,
  type ClientAuth,
} from './client';
import type { OAuthFailure } from './token-endpoint';

/** The `client_assertion_type` a JWT assertion declares (RFC 7523 §2.2). */
export const CLIENT_ASSERTION_TYPE =
  'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';

/** The longest assertion read, in characters; a signed set of six claims is well under a kilobyte. */
export const MAX_ASSERTION_LENGTH = 8000;

/** The largest key set read from a client's `jwks_uri`, in bytes. */
export const MAX_JWKS_BYTES = 32_000;

/** How long to wait for a client's key set. */
const JWKS_TIMEOUT_MS = 5000;

/** How far a client's clock may differ from ours, in seconds. */
export const CLOCK_TOLERANCE_SECONDS = 30;

/** The longest an assertion may be valid for, in seconds: it is a one-time proof of the moment, not a credential. */
export const MAX_ASSERTION_LIFETIME_SECONDS = 60 * 60;

/** The longest `jti` accepted; it is a database key. */
const MAX_JTI_LENGTH = 256;

/** What the request said about how the client authenticates. */
export interface AssertionFields {
  readonly assertion: string | undefined;
  readonly assertionType: string | undefined;
}

/** What checking an assertion reaches out to. */
export interface AssertionDeps {
  /** The client's key set, or undefined when it could not be fetched. */
  readonly fetchJwks: (uri: string) => Promise<unknown>;
  /** Record a `jti` as used; false if the client had already used it. */
  readonly claimAssertion: (
    clientId: string,
    jti: string,
    expiresAt: number,
  ) => Promise<boolean>;
}

/** An authentication failure, which is always `invalid_client`. */
const invalid = (description: string): OAuthFailure => ({
  ok: false,
  error: 'invalid_client',
  description,
});

/**
 * Fetch a client's key set. Redirects are not followed, the size and time are
 * capped (and on Workers only public hosts can be reached), and anything that
 * is not a JSON object comes back as undefined.
 */
export async function fetchJwks(
  uri: string,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  const response = await fetchImpl(uri, {
    redirect: 'manual',
    headers: { Accept: 'application/json', 'User-Agent': FETCH_USER_AGENT },
    signal: AbortSignal.timeout(JWKS_TIMEOUT_MS),
  }).catch(() => undefined);
  if (!response?.ok) {
    await response?.body?.cancel();
    return undefined;
  }
  const text = await readCappedText(response, MAX_JWKS_BYTES).catch(
    () => undefined,
  );
  try {
    return text === undefined ? undefined : (JSON.parse(text) as unknown);
  } catch {
    return undefined;
  }
}

/** The client id an assertion claims to be from (its `sub`), read without trusting it, for a request that left `client_id` out (RFC 7523 §2.2). */
export function assertionSubject(assertion: string): string | undefined {
  try {
    return decodeJwt(assertion).sub;
  } catch {
    return undefined;
  }
}

/**
 * Check a client's assertion. It must be signed with a key in the client's key
 * set (one of {@link ASSERTION_ALGORITHMS}, never `none` or a shared-secret
 * algorithm), name the client as both issuer and subject, be addressed to one
 * of `audiences` (the token endpoint or the issuer), carry an expiry no more
 * than {@link MAX_ASSERTION_LIFETIME_SECONDS} away and a `jti` that has not been
 * used. Returns the failure, or undefined when the client has proved itself.
 */
export async function verifyClientAssertion(
  auth: Readonly<ClientAuth>,
  clientId: string,
  fields: Readonly<AssertionFields>,
  audiences: readonly string[],
  deps: Readonly<AssertionDeps>,
  now: number,
): Promise<OAuthFailure | undefined> {
  const { assertion, assertionType } = fields;
  if (assertionType !== CLIENT_ASSERTION_TYPE || !assertion) {
    return invalid(
      `This client must authenticate with a signed client_assertion (client_assertion_type ${CLIENT_ASSERTION_TYPE}).`,
    );
  }
  if (assertion.length > MAX_ASSERTION_LENGTH) {
    return invalid('The client_assertion is too large.');
  }
  const jwks = await deps.fetchJwks(auth.jwksUri);
  if (jwks === undefined) {
    return invalid('The client keys could not be fetched.');
  }
  // Building the key set throws on a malformed one, verifying on a bad token.
  const verified = await (async () =>
    jwtVerify(assertion, createLocalJWKSet(jwks as JSONWebKeySet), {
      issuer: clientId,
      subject: clientId,
      audience: [...audiences],
      algorithms: [...ASSERTION_ALGORITHMS],
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      currentDate: new Date(now * 1000),
      requiredClaims: ['exp', 'jti'],
    }))().catch(() => undefined);
  if (!verified) {
    return invalid('The client_assertion is not valid.');
  }
  const { exp, jti } = verified.payload;
  const badJti =
    typeof jti !== 'string' || jti === '' || jti.length > MAX_JTI_LENGTH;
  if (
    exp === undefined ||
    exp > now + MAX_ASSERTION_LIFETIME_SECONDS ||
    badJti
  ) {
    return invalid('The client_assertion is not valid.');
  }
  return (await deps.claimAssertion(
    clientId,
    jti,
    exp + CLOCK_TOLERANCE_SECONDS,
  ))
    ? undefined
    : invalid('The client_assertion was already used.');
}
