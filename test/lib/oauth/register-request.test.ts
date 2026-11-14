import { describe, expect, it, jest } from '@jest/globals';

import {
  OAUTH_LIMITS,
  handleRegistration,
  type OAuthClient,
} from '@/lib/oauth';
import type { RateLimitStore } from '@/lib/rate-limit';

const body = JSON.stringify({
  client_name: 'Assistant',
  redirect_uris: ['https://app.example/cb'],
});

/** A store whose counter for every key starts at `already` hits. */
const store = (already = 0): RateLimitStore & { readonly keys: string[] } => {
  const keys: string[] = [];
  return {
    keys,
    async hit(key, now) {
      keys.push(key);
      return { count: already + keys.length, windowStart: now - 10 };
    },
    async purge() {},
  };
};

const setup = (already = 0) => {
  const rateLimits = store(already);
  const saved: OAuthClient[] = [];
  const save = jest.fn(async (client: Readonly<OAuthClient>) => {
    saved.push(client);
  });
  return { rateLimits, saved, save, deps: { rateLimits, save, now: 1000 } };
};

/** A body that was read in full. */
const text = (value: string) => ({ kind: 'ok' as const, text: value });

describe('handleRegistration', () => {
  it('registers a client and answers with the RFC 7591 body', async () => {
    const { deps, saved } = setup();
    const result = await handleRegistration(
      async () => text(body),
      '203.0.113.7',
      deps,
    );
    expect(result).toMatchObject({
      ok: true,
      body: {
        client_name: 'Assistant',
        token_endpoint_auth_method: 'none',
        client_id_issued_at: 1000,
      },
    });
    expect(saved).toHaveLength(1);
    expect(saved[0]?.clientId).toMatch(/^dcr_/);
  });

  it('counts the attempt against the caller address', async () => {
    const { deps, rateLimits } = setup();
    await handleRegistration(async () => text(body), '203.0.113.7', deps);
    expect(rateLimits.keys).toEqual([
      `${OAUTH_LIMITS.register.name}:203.0.113.7`,
    ]);
  });

  it('refuses a caller over the limit without reading the body or saving', async () => {
    const { deps, save } = setup(OAUTH_LIMITS.register.limit);
    const read = jest.fn(async () => text(body));
    const result = await handleRegistration(read, '203.0.113.7', deps);
    expect(result).toEqual({ ok: false, limited: true, retryAfter: 3590 });
    expect(read).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('reports a request that is not an acceptable client, and saves nothing', async () => {
    const { deps, save } = setup();
    expect(
      await handleRegistration(async () => text('{}'), 'a', deps),
    ).toMatchObject({
      ok: false,
      limited: false,
      error: 'invalid_redirect_uri',
    });
    expect(
      await handleRegistration(async () => text('nope'), 'a', deps),
    ).toMatchObject({
      ok: false,
      limited: false,
      error: 'invalid_client_metadata',
    });
    expect(save).not.toHaveBeenCalled();
  });

  it('reports a body over the size cap as too large, and one that is not text as invalid', async () => {
    const { deps, save } = setup();
    expect(
      await handleRegistration(async () => ({ kind: 'too-large' }), 'a', deps),
    ).toEqual({
      ok: false,
      limited: false,
      error: 'invalid_client_metadata',
      description: 'The request is too large.',
    });
    expect(
      await handleRegistration(async () => ({ kind: 'unreadable' }), 'a', deps),
    ).toMatchObject({ ok: false, error: 'invalid_client_metadata' });
    expect(save).not.toHaveBeenCalled();
  });

  it('counts invalid requests too', async () => {
    const { deps, rateLimits } = setup();
    await handleRegistration(async () => text('{}'), 'a', deps);
    expect(rateLimits.keys).toHaveLength(1);
  });
});
