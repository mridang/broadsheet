/**
 * @packageDocumentation
 *
 * The OAuth store on D1: registered clients, pending codes, grants and the
 * hashes of issued tokens (see `migrations/0011_oauth.sql`).
 */

import { and, eq, isNull, lt, sql } from 'drizzle-orm';

import type { Database } from '@/domain/db/database';
import {
  oauthClients,
  oauthCodes,
  oauthGrants,
  oauthTokens,
} from '@/domain/db/schema';
import type {
  OAuthClient,
  OAuthStore,
  StoredCode,
  StoredGrant,
  StoredToken,
  TokenKind,
} from '@/lib/oauth';

/** A JSON array of strings as stored, or none. */
function listOf(stored: string): string[] {
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === 'string')
      : [];
  } catch {
    return [];
  }
}

/** A space-separated scope as a list. */
const scopeOf = (stored: string): string[] => stored.split(' ').filter(Boolean);

/** A stored token row in the store's shape. */
function tokenOf(row: typeof oauthTokens.$inferSelect): StoredToken {
  return {
    tokenHash: row.token_hash,
    kind: row.kind as TokenKind,
    grantId: row.grant_id,
    expiresAt: row.expires_at,
  };
}

/** {@link OAuthStore} over the app's D1 database. */
export class D1OAuthStore implements OAuthStore {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  async findClient(clientId: string): Promise<OAuthClient | undefined> {
    const [row] = await this.#db
      .select()
      .from(oauthClients)
      .where(eq(oauthClients.client_id, clientId))
      .limit(1);
    return row
      ? {
          clientId: row.client_id,
          name: row.client_name,
          redirectUris: listOf(row.redirect_uris),
        }
      : undefined;
  }

  async saveClient(client: OAuthClient): Promise<void> {
    const insert = this.#db.insert(oauthClients).values({
      client_id: client.clientId,
      client_name: client.name,
      redirect_uris: JSON.stringify(client.redirectUris),
    });
    await insert;
  }

  async saveCode(code: StoredCode): Promise<void> {
    const insert = this.#db.insert(oauthCodes).values({
      code_hash: code.codeHash,
      client_id: code.clientId,
      user_id: code.userId,
      redirect_uri: code.redirectUri,
      code_challenge: code.codeChallenge,
      scope: code.scope.join(' '),
      resource: code.resource,
      expires_at: code.expiresAt,
    });
    await insert;
  }

  async takeCode(codeHash: string): Promise<StoredCode | undefined> {
    const [row] = await this.#db
      .delete(oauthCodes)
      .where(eq(oauthCodes.code_hash, codeHash))
      .returning();
    return row
      ? {
          codeHash: row.code_hash,
          clientId: row.client_id,
          userId: row.user_id,
          redirectUri: row.redirect_uri,
          codeChallenge: row.code_challenge,
          scope: scopeOf(row.scope),
          resource: row.resource,
          expiresAt: row.expires_at,
        }
      : undefined;
  }

  async saveGrant(grant: Omit<StoredGrant, 'revoked'>): Promise<void> {
    const insert = this.#db.insert(oauthGrants).values({
      id: grant.id,
      user_id: grant.userId,
      client_id: grant.clientId,
      scope: grant.scope.join(' '),
      resource: grant.resource,
    });
    await insert;
  }

  async findGrant(id: string): Promise<StoredGrant | undefined> {
    const [row] = await this.#db
      .select()
      .from(oauthGrants)
      .where(eq(oauthGrants.id, id))
      .limit(1);
    return row
      ? {
          id: row.id,
          userId: row.user_id,
          clientId: row.client_id,
          scope: scopeOf(row.scope),
          resource: row.resource,
          revoked: row.revoked_at !== null,
        }
      : undefined;
  }

  async revokeGrant(id: string): Promise<void> {
    await this.#db
      .update(oauthGrants)
      .set({ revoked_at: sql`(datetime('now'))` })
      .where(and(eq(oauthGrants.id, id), isNull(oauthGrants.revoked_at)));
    await this.#db.delete(oauthTokens).where(eq(oauthTokens.grant_id, id));
  }

  async saveToken(token: StoredToken): Promise<void> {
    const insert = this.#db.insert(oauthTokens).values({
      token_hash: token.tokenHash,
      kind: token.kind,
      grant_id: token.grantId,
      expires_at: token.expiresAt,
    });
    await insert;
  }

  async findToken(tokenHash: string): Promise<StoredToken | undefined> {
    const [row] = await this.#db
      .select()
      .from(oauthTokens)
      .where(eq(oauthTokens.token_hash, tokenHash))
      .limit(1);
    return row ? tokenOf(row) : undefined;
  }

  async takeToken(tokenHash: string): Promise<StoredToken | undefined> {
    const [row] = await this.#db
      .delete(oauthTokens)
      .where(eq(oauthTokens.token_hash, tokenHash))
      .returning();
    return row ? tokenOf(row) : undefined;
  }

  /**
   * Delete the codes and tokens that expired before `now` (Unix seconds),
   * which no request can use any more, returning how many of each.
   */
  async purgeExpired(
    now: number,
  ): Promise<{ readonly codes: number; readonly tokens: number }> {
    const codes = await this.#db
      .delete(oauthCodes)
      .where(lt(oauthCodes.expires_at, now))
      .returning({ hash: oauthCodes.code_hash });
    const tokens = await this.#db
      .delete(oauthTokens)
      .where(lt(oauthTokens.expires_at, now))
      .returning({ hash: oauthTokens.token_hash });
    return { codes: codes.length, tokens: tokens.length };
  }
}
