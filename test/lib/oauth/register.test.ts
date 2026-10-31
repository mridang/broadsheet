import { describe, expect, it } from '@jest/globals';

import { registerClient } from '@/lib/oauth/register';
import { MemoryStore } from './memory-store';

describe('registerClient', () => {
  it('registers a public client and stores it', async () => {
    const store = new MemoryStore();
    const result = await registerClient(
      { client_name: 'Claude', redirect_uris: ['https://claude.ai/cb'] },
      store,
      100,
    );
    const id = result.ok ? String(result.body['client_id']) : '';
    expect(await store.findClient(id)).toEqual({
      clientId: id,
      name: 'Claude',
      redirectUris: ['https://claude.ai/cb'],
    });
  });

  it('answers with the RFC 7591 members', async () => {
    const result = await registerClient(
      { redirect_uris: ['https://claude.ai/cb'] },
      new MemoryStore(),
      100,
    );
    expect(result.ok && result.body).toMatchObject({
      client_id_issued_at: 100,
      client_name: 'An unnamed app',
      token_endpoint_auth_method: 'none',
    });
  });

  it('refuses a body with no redirect URIs', async () => {
    const result = await registerClient({}, new MemoryStore(), 100);
    expect(!result.ok && result.error).toBe('invalid_client_metadata');
  });

  it('refuses a confidential client', async () => {
    const result = await registerClient(
      {
        redirect_uris: ['https://a.test/cb'],
        token_endpoint_auth_method: 'client_secret_basic',
      },
      new MemoryStore(),
      100,
    );
    expect(!result.ok && result.error).toBe('invalid_client_metadata');
  });

  it('refuses a redirect URI that is not safe', async () => {
    const result = await registerClient(
      { redirect_uris: ['http://evil.test/cb'] },
      new MemoryStore(),
      100,
    );
    expect(!result.ok && result.error).toBe('invalid_redirect_uri');
  });
});
