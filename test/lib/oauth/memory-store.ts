import type {
  OAuthClient,
  OAuthStore,
  StoredCode,
  StoredGrant,
  StoredToken,
} from '@/lib/oauth';

/** An {@link OAuthStore} in memory, for the lib tests. */
export class MemoryStore implements OAuthStore {
  readonly clients = new Map<string, OAuthClient>();
  readonly codes = new Map<string, StoredCode>();
  readonly grants = new Map<string, StoredGrant>();
  readonly tokens = new Map<string, StoredToken>();

  async findClient(id: string) {
    return this.clients.get(id);
  }
  async saveClient(client: OAuthClient) {
    this.clients.set(client.clientId, client);
  }
  async saveCode(code: StoredCode) {
    this.codes.set(code.codeHash, code);
  }
  async takeCode(hash: string) {
    const code = this.codes.get(hash);
    this.codes.delete(hash);
    return code;
  }
  async saveGrant(grant: Omit<StoredGrant, 'revoked'>) {
    this.grants.set(grant.id, { ...grant, revoked: false });
  }
  async findGrant(id: string) {
    return this.grants.get(id);
  }
  async revokeGrant(id: string) {
    const grant = this.grants.get(id);
    if (grant) this.grants.set(id, { ...grant, revoked: true });
    for (const [hash, token] of this.tokens) {
      if (token.grantId === id) this.tokens.delete(hash);
    }
  }
  async saveToken(token: StoredToken) {
    this.tokens.set(token.tokenHash, token);
  }
  async findToken(hash: string) {
    return this.tokens.get(hash);
  }
  async takeToken(hash: string) {
    const token = this.tokens.get(hash);
    this.tokens.delete(hash);
    return token;
  }
}
