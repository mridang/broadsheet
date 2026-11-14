/**
 * @packageDocumentation
 *
 * D1 persistence for the OAuth server: the client registry, grants, codes and
 * tokens. {@link D1OAuthStore} adapts it to the {@link OAuthStore}
 * interface the token logic is written against.
 */

import {
  and,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  notInArray,
  sql,
} from 'drizzle-orm';

import {
  MAX_LIVE_GRANTS_PER_APP,
  NEUTRAL_CLIENT_NAME,
  OAUTH_LIMITS,
  SUPPORTED_SCOPES,
  clientIdentity,
  fetchClientMetadata,
  firstRetryAfter,
  isDocumentFresh,
  isDocumentUsable,
  isMetadataDocumentUrl,
  logSecurityEvent,
  purgeCutoffs,
  sanitiseDisplayName,
  type ClientBusy,
  type CodeRecord,
  type GrantRecord,
  type OAuthClient,
  type OAuthStore,
  type Sweeps,
  type TokenRecord,
  type TokenRow,
} from '@/lib/oauth';
import {
  D1RateLimitStore,
  purgeRateLimits,
  type RateLimitStore,
} from '@/lib/rate-limit';
import type { Database } from '@/domain/db/client';
import {
  oauthAssertions,
  oauthClients,
  oauthCodes,
  oauthGrants,
  oauthTokens,
} from '@/domain/db/schema';

/** Unix seconds as the ISO-8601 text the timestamp columns hold. */
const iso = (seconds: number): string => new Date(seconds * 1000).toISOString();

/** The inverse of {@link iso}: a stored timestamp as Unix seconds, or null when it is unset. */
const seconds = (isoString: string | null): number | null =>
  isoString === null ? null : Math.floor(Date.parse(isoString) / 1000);

/** A row of the `oauth_clients` table. */
type ClientRow = typeof oauthClients.$inferSelect;

/** The redirect addresses stored as JSON text in a client row. */
function redirectUrisOf(json: string): readonly string[] {
  const parsed: unknown = JSON.parse(json);
  return Array.isArray(parsed)
    ? parsed.filter((uri): uri is string => typeof uri === 'string')
    : [];
}

/** The client a registry row stands for. */
function toClient(row: Readonly<ClientRow>): OAuthClient {
  return {
    clientId: row.client_id,
    name: row.client_name,
    redirectUris: redirectUrisOf(row.redirect_uris),
    kind: row.kind === 'cimd' ? 'cimd' : 'dcr',
    ...(row.auth_method === 'private_key_jwt' &&
      row.jwks_uri !== null && {
        auth: { method: 'private_key_jwt', jwksUri: row.jwks_uri },
      }),
    ...(row.logo_uri !== null && { logoUri: row.logo_uri }),
  };
}

/**
 * Save (or refresh) a client in the registry. For a client fetched from its
 * metadata document, `ttlSeconds` says how long the copy may be reused (from the
 * document's cache headers); it is ignored for registered clients.
 */
export async function saveClient(
  db: Database,
  client: Readonly<OAuthClient>,
  ttlSeconds?: number,
): Promise<void> {
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const fetched = client.kind === 'cimd';
  const values = {
    client_id: client.clientId,
    kind: client.kind,
    client_name: client.name,
    redirect_uris: JSON.stringify(client.redirectUris),
    created_at: now,
    fetched_at: fetched ? now : null,
    auth_method: client.auth?.method ?? 'none',
    jwks_uri: client.auth?.jwksUri ?? null,
    logo_uri: client.logoUri ?? null,
    expires_at:
      fetched && ttlSeconds !== undefined
        ? new Date(nowMs + ttlSeconds * 1000).toISOString()
        : null,
  };
  await db
    .insert(oauthClients)
    .values(values)
    .onConflictDoUpdate({
      target: oauthClients.client_id,
      set: {
        client_name: values.client_name,
        redirect_uris: values.redirect_uris,
        fetched_at: values.fetched_at,
        expires_at: values.expires_at,
        auth_method: values.auth_method,
        jwks_uri: values.jwks_uri,
        logo_uri: values.logo_uri,
      },
    });
}

/** What {@link resolveClient} needs besides the database; the defaults are the real thing. */
export interface ResolveDeps {
  /** Where the metadata-fetch rate limits are counted. Defaults to the database's `rate_limits` table. */
  readonly rateLimits?: RateLimitStore;
  /** The current time in milliseconds. */
  readonly now?: number;

  /**
   * This server's own origin. A `client_id` on it is never fetched: the
   * "document" would be one of our own pages, and every lookup would cost a
   * request to ourselves.
   */
  readonly origin?: string;

  /**
   * Who is asking (see `clientAddress`). Fetches are counted per asking
   * address before the overall allowance, so one caller naming many hosts
   * cannot use up the allowance everyone else shares.
   */
  readonly address?: string;
}

/** The cache timestamps of a registry row. */
const cachedOf = (row: Readonly<ClientRow>) => ({
  fetchedAt: row.fetched_at,
  expiresAt: row.expires_at,
});

/**
 * Look a client up by `client_id`. A registered client comes straight from the
 * database. A metadata-document URL is fetched and cached for as long as the
 * client's cache headers allow; a stale copy is refreshed, and still used (for
 * up to a week) if the refresh fails or is rate limited, so a client's brief
 * outage doesn't lock users out. Fetches are limited per host and overall; a
 * client that needs a fetch we may not make yet, and has no usable copy, comes
 * back as {@link ClientBusy}.
 */
export async function resolveClient(
  db: Database,
  clientId: string,
  fetchImpl: typeof fetch = fetch,
  deps: ResolveDeps = {},
): Promise<OAuthClient | ClientBusy | undefined> {
  const row = await db.query.oauthClients.findFirst({
    where: eq(oauthClients.client_id, clientId),
  });
  if (!isMetadataDocumentUrl(clientId, deps.origin)) {
    return row ? toClient(row) : undefined;
  }
  const nowMs = deps.now ?? Date.now();
  if (row && isDocumentFresh(cachedOf(row), nowMs)) {
    return toClient(row);
  }
  const fallback =
    row && isDocumentUsable(cachedOf(row), nowMs) ? toClient(row) : undefined;
  const wait = await firstRetryAfter(
    deps.rateLimits ?? new D1RateLimitStore(db.$client),
    [
      { limit: OAUTH_LIMITS.cimdHost, subject: new URL(clientId).host },
      ...(deps.address === undefined
        ? []
        : [{ limit: OAUTH_LIMITS.cimdAddress, subject: deps.address }]),
      { limit: OAUTH_LIMITS.cimdAll, subject: 'all' },
    ],
    Math.floor(nowMs / 1000),
  );
  if (wait !== undefined) {
    return fallback ?? { busy: true, retryAfterSeconds: wait };
  }
  const fetched = await fetchClientMetadata(clientId, fetchImpl, deps.origin);
  if (fetched.ok) {
    await saveClient(db, fetched.client, fetched.ttlSeconds);
    return fetched.client;
  }
  return fallback;
}

/** The rows to insert for a list of tokens. */
const tokenValues = (tokens: readonly TokenRow[]) =>
  tokens.map((t) => ({
    token_hash: t.hash,
    kind: t.kind,
    grant_id: t.grantId,
    expires_at: t.expiresAt,
  }));

/** How many rows a statement changed, from the result D1 returned for it. */
function changesOf(result: unknown): number {
  if (typeof result !== 'object' || result === null || !('meta' in result)) {
    return 0;
  }
  const { meta } = result;
  if (typeof meta !== 'object' || meta === null || !('changes' in meta)) {
    return 0;
  }
  return typeof meta.changes === 'number' ? meta.changes : 0;
}

/** The {@link OAuthStore} backed by a D1-bound Drizzle client. */
export class D1OAuthStore implements OAuthStore {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  async saveCode(hash: string, code: CodeRecord): Promise<void> {
    const insert = this.#db.insert(oauthCodes).values({
      code_hash: hash,
      client_id: code.clientId,
      user_id: code.userId,
      redirect_uri: code.redirectUri,
      redirect_uri_sent: code.redirectUriSent,
      code_challenge: code.codeChallenge,
      scope: code.scope.join(' '),
      resource: code.resource,
      expires_at: code.expiresAt,
      grant_id: null,
    });
    await insert;
  }

  async findCode(hash: string): Promise<CodeRecord | undefined> {
    const row = await this.#db.query.oauthCodes.findFirst({
      where: eq(oauthCodes.code_hash, hash),
    });
    return row
      ? {
          clientId: row.client_id,
          userId: row.user_id,
          redirectUri: row.redirect_uri,
          redirectUriSent: row.redirect_uri_sent,
          codeChallenge: row.code_challenge,
          scope: row.scope.split(' '),
          resource: row.resource,
          expiresAt: row.expires_at,
          grantId: row.grant_id,
        }
      : undefined;
  }

  async claimCode(hash: string, grantId: string): Promise<boolean> {
    const result = await this.#db
      .update(oauthCodes)
      .set({ grant_id: grantId })
      .where(and(eq(oauthCodes.code_hash, hash), isNull(oauthCodes.grant_id)))
      .run();
    return (result.meta.changes ?? 0) > 0;
  }

  async createGrant(
    grant: Omit<GrantRecord, 'revoked' | 'lastUsedAt'>,
    tokens: readonly TokenRow[],
  ): Promise<void> {
    const now = new Date().toISOString();
    const sameApp = and(
      eq(oauthGrants.user_id, grant.userId),
      eq(oauthGrants.client_id, grant.clientId),
      isNull(oauthGrants.revoked_at),
    );
    // The newest connections that stay: one fewer than the cap, to leave
    // room for the one being made.
    const kept = this.#db
      .select({ id: oauthGrants.id })
      .from(oauthGrants)
      .where(sameApp)
      .orderBy(desc(oauthGrants.created_at), desc(oauthGrants.id))
      .limit(MAX_LIVE_GRANTS_PER_APP - 1);
    // One batch is one transaction: the oldest connections beyond the cap are
    // retired, the new one and its first tokens appear, or none of it happens.
    // Other installs of the same app keep working.
    await this.#db.batch([
      this.#db
        .update(oauthGrants)
        .set({ revoked_at: now })
        .where(and(sameApp, notInArray(oauthGrants.id, kept))),
      this.#db.insert(oauthGrants).values({
        id: grant.id,
        user_id: grant.userId,
        client_id: grant.clientId,
        scope: grant.scope.join(' '),
        resource: grant.resource,
        created_at: now,
      }),
      this.#db.insert(oauthTokens).values(tokenValues(tokens)),
    ]);
  }

  async revokeGrant(grantId: string): Promise<void> {
    await this.#db
      .update(oauthGrants)
      .set({ revoked_at: new Date().toISOString() })
      .where(and(eq(oauthGrants.id, grantId), isNull(oauthGrants.revoked_at)));
  }

  async saveTokens(tokens: readonly TokenRow[]): Promise<void> {
    if (tokens.length > 0) {
      const insert = this.#db.insert(oauthTokens).values(tokenValues(tokens));
      await insert;
    }
  }

  async findToken(hash: string): Promise<TokenRecord | undefined> {
    const [row] = await this.#db
      .select({ token: oauthTokens, grant: oauthGrants })
      .from(oauthTokens)
      .innerJoin(oauthGrants, eq(oauthGrants.id, oauthTokens.grant_id))
      .where(eq(oauthTokens.token_hash, hash))
      .limit(1);
    if (!row) {
      return undefined;
    }
    return {
      kind: row.token.kind === 'access' ? 'access' : 'refresh',
      expiresAt: row.token.expires_at,
      usedAt: row.token.used_at,
      grant: {
        id: row.grant.id,
        userId: row.grant.user_id,
        clientId: row.grant.client_id,
        scope: row.grant.scope.split(' '),
        resource: row.grant.resource,
        revoked: row.grant.revoked_at !== null,
        lastUsedAt: seconds(row.grant.last_used_at),
      },
    };
  }

  async rotateRefreshToken(
    hash: string,
    now: number,
    tokens: readonly TokenRow[],
  ): Promise<boolean> {
    // The replacement tokens and the "spent" mark go in one transaction, so a
    // failure can never leave the old token spent with nothing to replace it.
    const [, claim] = await this.#db.batch([
      this.#db.insert(oauthTokens).values(tokenValues(tokens)),
      this.#db
        .update(oauthTokens)
        .set({ used_at: now })
        .where(
          and(eq(oauthTokens.token_hash, hash), isNull(oauthTokens.used_at)),
        ),
    ]);
    if (changesOf(claim) > 0) {
      return true;
    }
    // A parallel request spent the token first. Its replacement tokens were
    // never handed to anyone; take them back so only the winner's pair lives.
    await this.#db.delete(oauthTokens).where(
      inArray(
        oauthTokens.token_hash,
        tokens.map((t) => t.hash),
      ),
    );
    return false;
  }

  async touchGrant(grantId: string, now: number): Promise<void> {
    await this.#db
      .update(oauthGrants)
      .set({ last_used_at: iso(now) })
      .where(eq(oauthGrants.id, grantId));
  }

  async findClient(clientId: string): Promise<OAuthClient | undefined> {
    const row = await this.#db.query.oauthClients.findFirst({
      where: eq(oauthClients.client_id, clientId),
    });
    return row ? toClient(row) : undefined;
  }

  async claimAssertion(
    clientId: string,
    jti: string,
    expiresAt: number,
  ): Promise<boolean> {
    const result = await this.#db
      .insert(oauthAssertions)
      .values({ client_id: clientId, jti, expires_at: expiresAt })
      .onConflictDoNothing()
      .run();
    return changesOf(result) === 1;
  }
}

/** An approved application as the user sees it in the app. */
export interface ConnectedApp {
  /** The newest grant for the app: pass it to {@link revokeConnectedApp}. */
  readonly grantId: string;
  /** The app's name, cleaned for showing (it may have been saved before the current rules). */
  readonly name: string;

  /**
   * The most the app may do through any of its installs: the union of the
   * scopes of all its live grants, so an older edit-capable install is not
   * hidden behind a newer read-only one.
   */
  readonly scope: readonly string[];
  /** How many separate installs (live grants) of the app there are. */
  readonly installs: number;
  /** The domain that published the app, or null for an app that registered itself unverified. */
  readonly domain: string | null;
  /** The picture the app publishes for itself, or null when it has none. */
  readonly logoUri: string | null;
  readonly connectedAt: string;
  readonly lastUsedAt: string | null;
}

/** The scopes of several grants as one list: the supported scopes in their usual order, then anything else once. */
function unionOfScopes(scopes: readonly string[]): readonly string[] {
  const all = new Set(scopes.flatMap((scope) => scope.split(' ')));
  return [
    ...SUPPORTED_SCOPES.filter((scope) => all.has(scope)),
    ...[...all].filter(
      (scope) => !(SUPPORTED_SCOPES as readonly string[]).includes(scope),
    ),
  ];
}

/**
 * The applications a user has approved and not revoked, newest first. An app is
 * listed once: each install of an app has its own grant, and the grants of one
 * app are shown as one connection (the newest grant's date, the widest access
 * of any, the latest use of any, and how many installs there are).
 */
export async function listConnectedApps(
  db: Database,
  userId: number,
): Promise<readonly ConnectedApp[]> {
  const rows = await db
    .select({
      grant: oauthGrants,
      name: oauthClients.client_name,
      kind: oauthClients.kind,
      logo: oauthClients.logo_uri,
    })
    .from(oauthGrants)
    .leftJoin(oauthClients, eq(oauthClients.client_id, oauthGrants.client_id))
    .where(and(eq(oauthGrants.user_id, userId), isNull(oauthGrants.revoked_at)))
    .orderBy(desc(oauthGrants.created_at));
  return [...Map.groupBy(rows, (r) => r.grant.client_id).values()].flatMap(
    ([newest, ...older]) => {
      if (!newest) {
        return [];
      }
      const all = [newest, ...older];
      const lastUsed = all
        .flatMap((r) => (r.grant.last_used_at ? [r.grant.last_used_at] : []))
        .toSorted((a, b) => a.localeCompare(b))
        .at(-1);
      const identity = clientIdentity({
        clientId: newest.grant.client_id,
        kind: newest.kind === 'cimd' ? 'cimd' : 'dcr',
      });
      return [
        {
          grantId: newest.grant.id,
          name: sanitiseDisplayName(
            newest.name ?? newest.grant.client_id,
            NEUTRAL_CLIENT_NAME,
          ),
          scope: unionOfScopes(all.map((r) => r.grant.scope)),
          installs: all.length,
          domain: identity.kind === 'domain' ? identity.domain : null,
          logoUri: identity.kind === 'domain' ? (newest.logo ?? null) : null,
          connectedAt: newest.grant.created_at,
          lastUsedAt: lastUsed ?? null,
        },
      ];
    },
  );
}

/**
 * Whether `url` is the picture of an app the user has connected, which is what
 * entitles them to have the image proxy fetch it (see `images/access.ts`).
 */
export async function userHasConnectedLogo(
  db: Database,
  userId: number,
  url: string,
): Promise<boolean> {
  const row = await db
    .select({ id: oauthGrants.id })
    .from(oauthGrants)
    .innerJoin(oauthClients, eq(oauthClients.client_id, oauthGrants.client_id))
    .where(
      and(
        eq(oauthGrants.user_id, userId),
        isNull(oauthGrants.revoked_at),
        eq(oauthClients.kind, 'cimd'),
        eq(oauthClients.logo_uri, url),
      ),
    )
    .limit(1);
  return row.length > 0;
}

/**
 * Disconnect an app: revoke the grant named and every other live grant the user
 * has for the same app, so every install of it stops working (see
 * {@link listConnectedApps}). Returns false if the grant isn't theirs.
 */
export async function revokeConnectedApp(
  db: Database,
  userId: number,
  grantId: string,
): Promise<boolean> {
  const sameApp = db
    .select({ clientId: oauthGrants.client_id })
    .from(oauthGrants)
    .where(and(eq(oauthGrants.id, grantId), eq(oauthGrants.user_id, userId)));
  const result = await db
    .update(oauthGrants)
    .set({ revoked_at: new Date().toISOString() })
    .where(
      and(
        eq(oauthGrants.user_id, userId),
        inArray(oauthGrants.client_id, sameApp),
        isNull(oauthGrants.revoked_at),
      ),
    )
    .run();
  const revoked = result.meta.changes ?? 0;
  if (revoked > 0) {
    logSecurityEvent('oauth.grant_revoked', {
      grantId,
      userId,
      grants: revoked,
      reason: 'disconnected_by_user',
    });
  }
  return revoked > 0;
}

/**
 * Delete OAuth rows that are stale at `now` (Unix seconds): expired codes and
 * tokens, the tokens and old rows of revoked grants, grants nobody has used for
 * a long time (which are revoked, then removed once they have been revoked long
 * enough), and clients nobody ever approved. What counts as stale is decided by {@link purgeCutoffs}. Safe to
 * run at any time and by several requests at once; it is one batch.
 */
export async function purgeOAuthData(
  db: Database,
  now: number = Math.floor(Date.now() / 1000),
): Promise<void> {
  const cutoffs = purgeCutoffs(now);
  const revokedBefore = (iso: string) =>
    db
      .select({ id: oauthGrants.id })
      .from(oauthGrants)
      .where(lt(oauthGrants.revoked_at, iso));
  const grantedClients = db
    .select({ clientId: oauthGrants.client_id })
    .from(oauthGrants);
  await db.batch([
    // Connections nobody has used for half a year end quietly: their refresh
    // tokens ran out long ago, and they would otherwise sit in the list of
    // connected apps for ever. (Using a connection, including refreshing its
    // tokens, counts as use.)
    db
      .update(oauthGrants)
      .set({ revoked_at: new Date(now * 1000).toISOString() })
      .where(
        and(
          isNull(oauthGrants.revoked_at),
          lt(
            sql`coalesce(${oauthGrants.last_used_at}, ${oauthGrants.created_at})`,
            cutoffs.idleGrantsBefore,
          ),
        ),
      ),
    db
      .delete(oauthCodes)
      .where(lt(oauthCodes.expires_at, cutoffs.codesExpiredBefore)),
    db
      .delete(oauthTokens)
      .where(lt(oauthTokens.expires_at, cutoffs.tokensExpiredBefore)),
    db
      .delete(oauthAssertions)
      .where(lt(oauthAssertions.expires_at, cutoffs.tokensExpiredBefore)),
    db
      .delete(oauthTokens)
      .where(
        inArray(
          oauthTokens.grant_id,
          revokedBefore(cutoffs.revokedTokensBefore),
        ),
      ),
    db
      .delete(oauthGrants)
      .where(lt(oauthGrants.revoked_at, cutoffs.revokedGrantsBefore)),
    db
      .delete(oauthClients)
      .where(
        and(
          eq(oauthClients.kind, 'dcr'),
          lt(oauthClients.created_at, cutoffs.unusedDcrClientsBefore),
          notInArray(oauthClients.client_id, grantedClients),
        ),
      ),
    db
      .delete(oauthClients)
      .where(
        and(
          eq(oauthClients.kind, 'cimd'),
          lt(oauthClients.fetched_at, cutoffs.unusedCimdClientsBefore),
          notInArray(oauthClients.client_id, grantedClients),
        ),
      ),
  ]);
}

/** How long a rate-limit counter must sit idle before the background sweep removes it (one day). */
const IDLE_COUNTER_SECONDS = 24 * 60 * 60;

/** The clean-ups a request may start in the background (see `sweepSometimes`): stale OAuth rows and idle rate-limit counters. */
export function oauthSweeps(db: Database): Sweeps {
  return {
    purgeOAuth: () => purgeOAuthData(db),
    purgeRateLimits: () =>
      purgeRateLimits(new D1RateLimitStore(db.$client), IDLE_COUNTER_SECONDS),
  };
}
