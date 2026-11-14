/**
 * @packageDocumentation
 *
 * The logic behind `/oauth/token` and bearer-token checks, free of I/O: all
 * persistence goes through an {@link OAuthStore}, so the rules can be tested
 * with an in-memory fake and implemented over D1 in production.
 *
 * Security rules enforced here:
 *  - an authorization code works once; presenting it again revokes everything
 *    that was issued from it (a sign it was stolen);
 *  - PKCE must verify, and the client and redirect URI must match the request;
 *  - refresh tokens rotate on every use; presenting an old one again revokes
 *    the whole grant, except for a short grace window right after a rotation
 *    (see {@link REFRESH_GRACE_SECONDS});
 *  - every approval makes its own grant, so a user's other installs of the same
 *    app keep working (at most `MAX_LIVE_GRANTS_PER_APP` stay live);
 *  - an access token is only good for the MCP server it was issued for.
 */

import type { OAuthClient } from '@/lib/oauth/client';
import { verifyPkce } from '@/lib/oauth/pkce';
import {
  ACCESS_PREFIX,
  CODE_PREFIX,
  REFRESH_PREFIX,
  hashSecret,
  newSecret,
} from '@/lib/oauth/secrets';
import {
  SCOPE_OFFLINE_ACCESS,
  hasScope,
  isSupportedScope,
} from '@/lib/oauth/scopes';
import { logSecurityEvent } from '@/lib/oauth/security-log';

/** Access tokens live an hour; refresh tokens thirty days, renewed on use. */
export const ACCESS_TTL_SECONDS = 60 * 60;
/** How long a refresh token lasts, in seconds (30 days). */
export const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30;

/**
 * Authorization codes are good for two minutes: a client redeems its code the
 * moment the browser returns, and a short life shrinks the window in which a
 * leaked code is any use (OAuth 2.1 recommends at most ten minutes).
 */
export const CODE_TTL_SECONDS = 60 * 2;

/**
 * How long after a refresh token has been rotated the same token is still
 * answered with a fresh pair instead of being treated as stolen.
 *
 * Why: a client that loses the response to a refresh (a dropped connection, a
 * crash before it saved the new tokens) or two processes that share one
 * credential store and refresh at once will present the old token a second
 * time. Without a grace window that looks exactly like theft, the whole grant
 * is revoked and the person has to approve the app again.
 *
 * The trade-off: for this many seconds after a rotation, someone who copied the
 * old token can also obtain a working pair, and the two chains then go on
 * independently with no reuse detected. A minute is long enough for a retry or
 * a parallel refresh and short enough that a token replayed later (the real
 * signature of theft: the thief uses it after the owner has moved on) still
 * revokes the grant. This is a common practice among identity providers (often
 * called a "reuse interval"), not something RFC 9700 prescribes; every retry
 * inside the window is logged (`oauth.refresh_grace_retry`) as the compensating
 * control for the weaker detection.
 */
export const REFRESH_GRACE_SECONDS = 60;

/** A stored authorization code. */
export interface CodeRecord {
  readonly clientId: string;
  readonly userId: number;
  readonly redirectUri: string;

  /**
   * Whether the authorization request carried a `redirect_uri` (rather than the
   * client's only registered address being assumed). OAuth 2.1 §4.1.3 asks for
   * the parameter at the token endpoint only when it was sent.
   */
  readonly redirectUriSent: boolean;
  readonly codeChallenge: string;
  readonly scope: readonly string[];
  readonly resource: string;
  readonly expiresAt: number;
  /** Set once the code has been redeemed. */
  readonly grantId: string | null;
}

/** A user's approval of a client. */
export interface GrantRecord {
  readonly id: string;
  readonly userId: number;
  readonly clientId: string;
  readonly scope: readonly string[];
  readonly resource: string;
  readonly revoked: boolean;
  readonly lastUsedAt: number | null;
}

/** A stored token with its grant. */
export interface TokenRecord {
  readonly kind: 'access' | 'refresh';
  readonly expiresAt: number;
  readonly usedAt: number | null;
  readonly grant: GrantRecord;
}

/** A token row to store: only the hash of the secret is ever kept. */
export interface TokenRow {
  readonly hash: string;
  readonly kind: 'access' | 'refresh';
  readonly grantId: string;
  readonly expiresAt: number;
}

/** Everything the token logic needs from storage. */
export interface OAuthStore {
  saveCode(hash: string, code: CodeRecord): Promise<void>;
  findCode(hash: string): Promise<CodeRecord | undefined>;
  /** Atomically claim a code; false if it was already claimed. */
  claimCode(hash: string, grantId: string): Promise<boolean>;

  /**
   * Record a user's approval of a client together with the first token pair,
   * as one step. Other grants of the same user and client are left alone (each
   * install of an app approves separately); only those beyond
   * MAX_LIVE_GRANTS_PER_APP are retired in the same step, oldest first.
   */
  createGrant(
    grant: Omit<GrantRecord, 'revoked' | 'lastUsedAt'>,
    tokens: readonly TokenRow[],
  ): Promise<void>;
  revokeGrant(grantId: string): Promise<void>;
  /** Store tokens under an existing grant. */
  saveTokens(tokens: readonly TokenRow[]): Promise<void>;
  findToken(hash: string): Promise<TokenRecord | undefined>;

  /**
   * Rotate a refresh token: mark it used and store its replacement tokens as
   * one atomic step. False (and nothing stored) if it had already been used,
   * which is how two parallel refreshes are told apart.
   */
  rotateRefreshToken(
    hash: string,
    now: number,
    tokens: readonly TokenRow[],
  ): Promise<boolean>;
  touchGrant(grantId: string, now: number): Promise<void>;

  /**
   * Remember that a client assertion (by its `jti`) has been used, until
   * `expiresAt`. False if that client already used that `jti`, which is how a
   * replayed assertion is told from a fresh one.
   */
  claimAssertion(
    clientId: string,
    jti: string,
    expiresAt: number,
  ): Promise<boolean>;
  /** The client as last registered or fetched, if it is known; never fetches. */
  findClient(clientId: string): Promise<OAuthClient | undefined>;
}

/** An OAuth error response. */
export interface OAuthFailure {
  readonly ok: false;
  readonly error: string;
  readonly description: string;
}

/** A successful token response body. */
export interface TokenResponse {
  readonly access_token: string;
  readonly token_type: 'Bearer';
  readonly expires_in: number;
  readonly refresh_token: string;
  readonly scope: string;
}

/** A failed exchange, with the OAuth error code and a sentence for the client. */
const fail = (error: string, description: string): OAuthFailure => ({
  ok: false,
  error,
  description,
});

/** Mint a one-time authorization code for an approved request. */
export async function issueAuthorizationCode(
  store: OAuthStore,
  record: Omit<CodeRecord, 'expiresAt' | 'grantId'>,
  now: number,
): Promise<string> {
  const code = newSecret(CODE_PREFIX);
  await store.saveCode(await hashSecret(code), {
    ...record,
    expiresAt: now + CODE_TTL_SECONDS,
    grantId: null,
  });
  return code;
}

/** A freshly minted token pair: the response for the client and the rows to store. */
interface MintedTokens {
  readonly response: TokenResponse;
  readonly rows: readonly TokenRow[];
}

/** Mint an access + refresh pair under a grant. Nothing is stored yet. */
async function mintTokens(
  grantId: string,
  scope: readonly string[],
  now: number,
): Promise<MintedTokens> {
  const access = newSecret(ACCESS_PREFIX);
  const refresh = newSecret(REFRESH_PREFIX);
  return {
    rows: [
      {
        hash: await hashSecret(access),
        kind: 'access',
        grantId,
        expiresAt: now + ACCESS_TTL_SECONDS,
      },
      {
        hash: await hashSecret(refresh),
        kind: 'refresh',
        grantId,
        expiresAt: now + REFRESH_TTL_SECONDS,
      },
    ],
    response: {
      access_token: access,
      token_type: 'Bearer',
      expires_in: ACCESS_TTL_SECONDS,
      refresh_token: refresh,
      scope: scope.join(' '),
    },
  };
}

/** The parameters of an `authorization_code` token request. */
export interface CodeExchange {
  readonly code: string;
  readonly clientId: string;
  readonly redirectUri: string | undefined;
  readonly codeVerifier: string | undefined;
  /** The `resource` in the request, if sent. */
  readonly resource: string | undefined;
}

/** Redeem an authorization code for tokens. */
export async function exchangeAuthorizationCode(
  store: OAuthStore,
  request: CodeExchange,
  isOurResource: (resource: string) => boolean,
  now: number,
): Promise<TokenResponse | OAuthFailure> {
  const hash = await hashSecret(request.code);
  const code = await store.findCode(hash);
  if (!code) {
    return fail('invalid_grant', 'The authorization code is not valid.');
  }
  if (code.grantId) {
    // A used code coming back means someone copied it: revoke what it made.
    await store.revokeGrant(code.grantId);
    logSecurityEvent('oauth.code_replay_detected', {
      grantId: code.grantId,
      clientId: code.clientId,
      userId: code.userId,
    });
    return fail('invalid_grant', 'The authorization code was already used.');
  }
  if (code.expiresAt <= now) {
    return fail('invalid_grant', 'The authorization code has expired.');
  }
  if (code.clientId !== request.clientId) {
    return fail('invalid_grant', 'The code was issued to a different client.');
  }
  // A client that left the address out of the authorization request may leave
  // it out here too; one that sent it must send the same one again.
  const redirectMismatch = code.redirectUriSent
    ? request.redirectUri !== code.redirectUri
    : request.redirectUri !== undefined &&
      request.redirectUri !== code.redirectUri;
  if (redirectMismatch) {
    return fail(
      'invalid_grant',
      'The redirect_uri does not match the request.',
    );
  }
  if (
    !request.codeVerifier ||
    !(await verifyPkce(request.codeVerifier, code.codeChallenge))
  ) {
    return fail('invalid_grant', 'The PKCE code_verifier does not match.');
  }
  if (request.resource !== undefined && !isOurResource(request.resource)) {
    return fail('invalid_target', 'The resource is not this MCP server.');
  }

  const grantId = crypto.randomUUID();
  if (!(await store.claimCode(hash, grantId))) {
    return fail('invalid_grant', 'The authorization code was already used.');
  }
  const minted = await mintTokens(grantId, code.scope, now);
  await store.createGrant(
    {
      id: grantId,
      userId: code.userId,
      clientId: code.clientId,
      scope: code.scope,
      resource: code.resource,
    },
    minted.rows,
  );
  logSecurityEvent('oauth.grant_created', {
    grantId,
    clientId: code.clientId,
    userId: code.userId,
    scope: code.scope.join(' '),
  });
  return minted.response;
}

/** The parameters of a `refresh_token` request. */
export interface RefreshExchange {
  readonly refreshToken: string;
  readonly clientId: string;
  /** The scope asked for, which may not exceed the grant (and does not narrow it). */
  readonly scope: string | undefined;
  /** The `resource` in the request, if sent (RFC 8707 allows it on a refresh too). */
  readonly resource?: string;
}

/** Whether a refresh token used at `usedAt` may still be presented again (see {@link REFRESH_GRACE_SECONDS}). */
export function withinRefreshGrace(
  usedAt: number | null,
  now: number,
): boolean {
  return usedAt !== null && now - usedAt <= REFRESH_GRACE_SECONDS;
}

/** Whether a refresh token that someone else just rotated was used within the grace window (read afresh from storage). */
async function usedWithinGrace(
  store: OAuthStore,
  hash: string,
  now: number,
): Promise<boolean> {
  const current = await store.findToken(hash);
  return withinRefreshGrace(current?.usedAt ?? null, now);
}

/**
 * Exchange a refresh token for a new pair, rotating the refresh token.
 *
 * Reuse of a spent token ends the whole grant, because it is the sign that a
 * copy was stolen, with one exception: within {@link REFRESH_GRACE_SECONDS} of
 * the rotation the same token is answered with another fresh pair and the grant
 * stays alive. That covers a client that lost the response and tries again, and
 * a parallel refresh that lost the race to rotate. (The pair issued earlier
 * stays valid until it expires; it cannot be handed back because only hashes of
 * tokens are kept.).
 */
export async function exchangeRefreshToken(
  store: OAuthStore,
  request: RefreshExchange,
  isOurResource: (resource: string) => boolean,
  now: number,
): Promise<TokenResponse | OAuthFailure> {
  const hash = await hashSecret(request.refreshToken);
  const token = await store.findToken(hash);
  if (!token || token.kind !== 'refresh') {
    return fail('invalid_grant', 'The refresh token is not valid.');
  }
  const { grant, usedAt, expiresAt } = token;
  if (grant.revoked) {
    return fail('invalid_grant', 'Access for this application was revoked.');
  }
  if (grant.clientId !== request.clientId) {
    return fail(
      'invalid_grant',
      'The refresh token belongs to a different client.',
    );
  }
  const spent = usedAt !== null;
  if (spent && !withinRefreshGrace(usedAt, now)) {
    // An already-rotated token came back late: assume theft and end the grant.
    await store.revokeGrant(grant.id);
    logReuse(grant, usedAt, now);
    return fail('invalid_grant', 'The refresh token was already used.');
  }
  if (expiresAt <= now) {
    return fail('invalid_grant', 'The refresh token has expired.');
  }

  if (request.resource !== undefined && !isOurResource(request.resource)) {
    return fail('invalid_target', 'The resource is not this MCP server.');
  }
  if (request.scope) {
    // Covered by the grant, not merely listed in it: a grant of the write scope
    // covers the read one. `offline_access` asks for what a refresh already is.
    const asked = request.scope
      .split(/\s+/)
      .filter((s) => s !== '' && s !== SCOPE_OFFLINE_ACCESS);
    if (!asked.every((s) => isSupportedScope(s) && hasScope(grant.scope, s))) {
      return fail(
        'invalid_scope',
        'Cannot widen the scope of a refresh token.',
      );
    }
  }
  // Tokens are not scoped one by one: whatever was asked, the new pair carries
  // the whole grant's scope, and the response says so rather than pretending to
  // have narrowed it.
  const minted = await mintTokens(grant.id, grant.scope, now);
  if (!spent && (await store.rotateRefreshToken(hash, now, minted.rows))) {
    await store.touchGrant(grant.id, now);
    return minted.response;
  }
  if (!spent && !(await usedWithinGrace(store, hash, now))) {
    // Not a retry and not a lost race either: nothing explains the reuse.
    await store.revokeGrant(grant.id);
    logReuse(grant, null, now);
    return fail('invalid_grant', 'The refresh token was already used.');
  }
  // A retry inside the grace window, or a parallel refresh that lost the race
  // by moments: give this caller its own pair without touching the grant.
  logSecurityEvent('oauth.refresh_grace_retry', {
    grantId: grant.id,
    clientId: grant.clientId,
  });
  await store.saveTokens(minted.rows);
  return minted.response;
}

/** Log that a spent refresh token came back too late (`usedAt` is when it was spent, if known). */
function logReuse(
  grant: Readonly<GrantRecord>,
  usedAt: number | null,
  now: number,
): void {
  logSecurityEvent('oauth.refresh_reuse_detected', {
    grantId: grant.id,
    clientId: grant.clientId,
    userId: grant.userId,
    secondsSinceUse: usedAt === null ? null : now - usedAt,
  });
}

/** Who a valid access token speaks for. */
export interface AccessIdentity {
  readonly userId: number;
  readonly scope: readonly string[];
  readonly grantId: string;
}

/** How often to record that a grant is in use (saves a write per request). */
const TOUCH_INTERVAL_SECONDS = 60 * 5;

/**
 * Resolve a bearer access token to the user and scopes it grants, or undefined
 * if it is unknown, expired, revoked, a refresh token, or for another server.
 */
export async function authenticateAccessToken(
  store: OAuthStore,
  accessToken: string,
  resource: string,
  now: number,
): Promise<AccessIdentity | undefined> {
  const token = await store.findToken(await hashSecret(accessToken));
  if (!token || token.kind !== 'access' || token.expiresAt <= now) {
    return undefined;
  }
  const { grant } = token;
  if (grant.revoked || grant.resource !== resource) {
    return undefined;
  }
  if (
    grant.lastUsedAt === null ||
    now - grant.lastUsedAt > TOUCH_INTERVAL_SECONDS
  ) {
    await store.touchGrant(grant.id, now);
  }
  return { userId: grant.userId, scope: grant.scope, grantId: grant.id };
}

/** Revoke the grant a token belongs to (RFC 7009). Unknown tokens are ignored. */
export async function revokeToken(
  store: OAuthStore,
  token: string,
): Promise<void> {
  const found = await store.findToken(await hashSecret(token));
  if (found) {
    await store.revokeGrant(found.grant.id);
    logSecurityEvent('oauth.grant_revoked', {
      grantId: found.grant.id,
      clientId: found.grant.clientId,
      reason: 'token_revoked_by_client',
    });
  }
}
