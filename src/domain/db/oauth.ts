/**
 * @packageDocumentation
 *
 * The OAuth store on D1: registered clients, pending codes, grants and the
 * hashes of issued tokens (see `migrations/0011_oauth.sql`).
 */

import { and, eq, isNull, sql } from 'drizzle-orm';

import type { Database } from '@/domain/db/database';
import {
  oauth_clients,
  oauth_codes,
  oauth_grants,
  oauth_tokens,
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
function tokenOf(row: typeof oauth_tokens.$inferSelect): StoredToken {
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
      .from(oauth_clients)
      .where(eq(oauth_clients.client_id, clientId))
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
    await this.#db.insert(oauth_clients).values({
      client_id: client.clientId,
      client_name: client.name,
      redirect_uris: JSON.stringify(client.redirectUris),
    });
  }

  async saveCode(code: StoredCode): Promise<void> {
    await this.#db.insert(oauth_codes).values({
      code_hash: code.codeHash,
      client_id: code.clientId,
      user_id: code.userId,
      redirect_uri: code.redirectUri,
      code_challenge: code.codeChallenge,
      scope: code.scope.join(' '),
      resource: code.resource,
      expires_at: code.expiresAt,
    });
  }

  async takeCode(codeHash: string): Promise<StoredCode | undefined> {
    const [row] = await this.#db
      .delete(oauth_codes)
      .where(eq(oauth_codes.code_hash, codeHash))
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
    await this.#db.insert(oauth_grants).values({
      id: grant.id,
      user_id: grant.userId,
      client_id: grant.clientId,
      scope: grant.scope.join(' '),
      resource: grant.resource,
    });
  }

  async findGrant(id: string): Promise<StoredGrant | undefined> {
    const [row] = await this.#db
      .select()
      .from(oauth_grants)
      .where(eq(oauth_grants.id, id))
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
      .update(oauth_grants)
      .set({ revoked_at: sql`(datetime('now'))` })
      .where(and(eq(oauth_grants.id, id), isNull(oauth_grants.revoked_at)));
    await this.#db.delete(oauth_tokens).where(eq(oauth_tokens.grant_id, id));
  }

  async saveToken(token: StoredToken): Promise<void> {
    await this.#db.insert(oauth_tokens).values({
      token_hash: token.tokenHash,
      kind: token.kind,
      grant_id: token.grantId,
      expires_at: token.expiresAt,
    });
  }

  async findToken(tokenHash: string): Promise<StoredToken | undefined> {
    const [row] = await this.#db
      .select()
      .from(oauth_tokens)
      .where(eq(oauth_tokens.token_hash, tokenHash))
      .limit(1);
    return row ? tokenOf(row) : undefined;
  }

  async takeToken(tokenHash: string): Promise<StoredToken | undefined> {
    const [row] = await this.#db
      .delete(oauth_tokens)
      .where(eq(oauth_tokens.token_hash, tokenHash))
      .returning();
    return row ? tokenOf(row) : undefined;
  }
}
