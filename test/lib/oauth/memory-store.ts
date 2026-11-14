import {
  MAX_LIVE_GRANTS_PER_APP,
  type CodeRecord,
  type GrantRecord,
  type OAuthClient,
  type OAuthStore,
  type TokenRecord,
  type TokenRow,
} from '@/lib/oauth';

/** A token as the memory store keeps it. */
interface StoredToken {
  kind: 'access' | 'refresh';
  grantId: string;
  expiresAt: number;
  usedAt: number | null;
}

/** An in-memory store with the same atomic-claim behaviour as D1, for tests. */
export class MemoryStore implements OAuthStore {
  codes = new Map<string, CodeRecord>();
  grants = new Map<string, GrantRecord>();
  tokens = new Map<string, StoredToken>();
  touched: string[] = [];

  async saveCode(hash: string, code: CodeRecord) {
    this.codes.set(hash, code);
  }
  async findCode(hash: string) {
    return this.codes.get(hash);
  }
  async claimCode(hash: string, grantId: string) {
    const code = this.codes.get(hash);
    if (!code || code.grantId) {
      return false;
    }
    this.codes.set(hash, { ...code, grantId });
    return true;
  }
  async createGrant(
    grant: Omit<GrantRecord, 'revoked' | 'lastUsedAt'>,
    tokens: readonly TokenRow[],
  ) {
    // Other installs of the same app stay; the oldest beyond the cap go (a Map
    // keeps insertion order, which is creation order).
    const live = [...this.grants.values()].filter(
      (other) =>
        other.userId === grant.userId &&
        other.clientId === grant.clientId &&
        !other.revoked,
    );
    for (const other of live.slice(
      0,
      Math.max(0, live.length - (MAX_LIVE_GRANTS_PER_APP - 1)),
    )) {
      this.grants.set(other.id, { ...other, revoked: true });
    }
    this.grants.set(grant.id, { ...grant, revoked: false, lastUsedAt: null });
    await this.saveTokens(tokens);
  }
  async revokeGrant(grantId: string) {
    const grant = this.grants.get(grantId);
    if (grant) {
      this.grants.set(grantId, { ...grant, revoked: true });
    }
  }
  async saveTokens(tokens: readonly TokenRow[]) {
    for (const { hash, ...token } of tokens) {
      this.tokens.set(hash, { ...token, usedAt: null });
    }
  }
  async findToken(hash: string): Promise<TokenRecord | undefined> {
    const token = this.tokens.get(hash);
    const grant = token && this.grants.get(token.grantId);
    return token && grant ? { ...token, grant } : undefined;
  }
  async rotateRefreshToken(
    hash: string,
    now: number,
    tokens: readonly TokenRow[],
  ) {
    const token = this.tokens.get(hash);
    if (!token || token.usedAt !== null) {
      return false;
    }
    this.tokens.set(hash, { ...token, usedAt: now });
    await this.saveTokens(tokens);
    return true;
  }
  clients = new Map<string, OAuthClient>();
  assertions = new Set<string>();

  async findClient(clientId: string) {
    return this.clients.get(clientId);
  }
  async claimAssertion(clientId: string, jti: string) {
    const key = `${clientId} ${jti}`;
    if (this.assertions.has(key)) {
      return false;
    }
    this.assertions.add(key);
    return true;
  }
  async touchGrant(grantId: string, now: number) {
    this.touched.push(grantId);
    const grant = this.grants.get(grantId);
    if (grant) {
      this.grants.set(grantId, { ...grant, lastUsedAt: now });
    }
  }
}
