/**
 * @packageDocumentation
 *
 * What the authorization server keeps, as an interface: the app supplies the
 * database behind it (`domain/db/oauth.ts`), tests an in-memory one.
 */

/** A registered public client. */
export interface OAuthClient {
  readonly clientId: string;
  readonly name: string;
  readonly redirectUris: readonly string[];
}

/** An authorization code waiting to be redeemed, by the hash of the code. */
export interface StoredCode {
  readonly codeHash: string;
  readonly clientId: string;
  readonly userId: number;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly scope: readonly string[];
  readonly resource: string;
  readonly expiresAt: number;
}

/** One person's approval of one client. */
export interface StoredGrant {
  readonly id: string;
  readonly userId: number;
  readonly clientId: string;
  readonly scope: readonly string[];
  readonly resource: string;
  readonly revoked: boolean;
}

/** Which kind of token a hash belongs to. */
export type TokenKind = 'access' | 'refresh';

/** An issued token, by the hash of the token. */
export interface StoredToken {
  readonly tokenHash: string;
  readonly kind: TokenKind;
  readonly grantId: string;
  readonly expiresAt: number;
}

/** The authorization server's storage. Times are Unix seconds. */
export interface OAuthStore {
  findClient(clientId: string): Promise<OAuthClient | undefined>;
  saveClient(client: OAuthClient): Promise<void>;
  saveCode(code: StoredCode): Promise<void>;
  /** Remove and return a code, so it can only be redeemed once. */
  takeCode(codeHash: string): Promise<StoredCode | undefined>;
  saveGrant(grant: Omit<StoredGrant, 'revoked'>): Promise<void>;
  findGrant(id: string): Promise<StoredGrant | undefined>;
  /** Revoke a grant and forget every token issued under it. */
  revokeGrant(id: string): Promise<void>;
  saveToken(token: StoredToken): Promise<void>;
  findToken(tokenHash: string): Promise<StoredToken | undefined>;
  /** Remove and return a token, so a refresh token is used only once. */
  takeToken(tokenHash: string): Promise<StoredToken | undefined>;
}
