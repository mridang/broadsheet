import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import type { DatabaseSync } from 'node:sqlite';

import { OPTIONS, POST } from '@/app/oauth/register/route';
import {
  installCloudflareContext,
  sqliteD1,
} from '../../../lib/core/db/sqlite-d1';
import { quietSecurityLogs } from '../../../lib/oauth/quiet-logs';
import { APP_MIGRATIONS } from '../../../lib/core/db/migrations';
import urls from '../../../fixtures/insecure-urls.json' with { type: 'json' };

const body = JSON.stringify({
  client_name: 'Assistant',
  redirect_uris: ['https://app.example/cb'],
});

const post = (text: string, headers: Record<string, string> = {}) =>
  POST(
    new Request('https://app.test/oauth/register', {
      method: 'POST',
      body: text,
      headers: { 'cf-connecting-ip': '203.0.113.7', ...headers },
    }),
  );

quietSecurityLogs();

let raw: DatabaseSync;
let restore: () => void;

beforeEach(() => {
  const made = sqliteD1(...APP_MIGRATIONS);
  raw = made.raw;
  restore = installCloudflareContext(made.d1);
});

afterEach(() => restore());

/** How many clients are in the registry. */
const registered = (): unknown =>
  raw.prepare('SELECT COUNT(*) AS n FROM oauth_clients').get()?.['n'];

describe('POST /oauth/register', () => {
  it('registers a client and answers 201 with its details, uncached', async () => {
    const res = await post(body);
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).toMatchObject({
      client_name: 'Assistant',
      redirect_uris: ['https://app.example/cb'],
      token_endpoint_auth_method: 'none',
    });
    expect(
      raw.prepare('SELECT client_id, kind FROM oauth_clients').all(),
    ).toEqual([{ client_id: json['client_id'], kind: 'dcr' }]);
  });

  it('answers 400 with an OAuth error for an unacceptable redirect address', async () => {
    const res = await post(
      JSON.stringify({ redirect_uris: [urls.exampleCallback] }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_redirect_uri' });
    expect(registered()).toBe(0);
  });

  it('registers a client that asks for a secret as the public client it will be, and says so', async () => {
    const res = await post(
      JSON.stringify({
        redirect_uris: ['https://app.example/cb'],
        token_endpoint_auth_method: 'client_secret_basic',
        grant_types: ['authorization_code', 'client_credentials'],
      }),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
    });
  });

  it('answers 400 for a client that wants no grant this server offers', async () => {
    const res = await post(
      JSON.stringify({
        redirect_uris: ['https://app.example/cb'],
        grant_types: ['client_credentials'],
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: 'invalid_client_metadata',
    });
  });

  it('sets Pragma: no-cache with Cache-Control: no-store', async () => {
    const res = await post(body);
    expect(res.headers.get('pragma')).toBe('no-cache');
  });

  it('answers 400 for a body over 8,000 bytes without reading past the cap', async () => {
    const pulled = { chunks: 0 };
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled.chunks += 1;
        controller.enqueue(new Uint8Array(4000));
      },
    });
    const res = await POST(
      new Request('https://app.test/oauth/register', {
        method: 'POST',
        body: stream,
        duplex: 'half',
        headers: { 'cf-connecting-ip': '203.0.113.7' },
      } as RequestInit),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: 'invalid_client_metadata',
      error_description: 'The request is too large.',
    });
    expect(pulled.chunks).toBeLessThan(10);
    expect(registered()).toBe(0);
  });

  it('answers 400 for a declared Content-Length over the cap, unread', async () => {
    const res = await post(body, { 'content-length': '9000' });
    expect(res.status).toBe(400);
    expect(registered()).toBe(0);
  });

  it('answers 400 for a body that is not valid UTF-8', async () => {
    const res = await POST(
      new Request('https://app.test/oauth/register', {
        method: 'POST',

        body: new Uint8Array([0xff, 0xfe, 0x7b]),
        headers: { 'cf-connecting-ip': '203.0.113.7' },
      }),
    );
    expect(res.status).toBe(400);
  });

  it('accepts a client that says its method is "none"', async () => {
    const res = await post(
      JSON.stringify({
        redirect_uris: ['https://app.example/cb'],
        token_endpoint_auth_method: 'none',
      }),
    );
    expect(res.status).toBe(201);
  });

  it('answers 429 with Retry-After once an address has registered too much, and stores nothing more', async () => {
    const statuses: number[] = [];
    // One at a time, as a real caller would: each registration is a D1 write.
    for (let i = 0; i < 21; i += 1) {
      const res = await post(body);
      statuses.push(res.status);
      if (res.status === 429) {
        expect(res.headers.get('retry-after')).toMatch(/^\d+$/);
        expect(await res.json()).toMatchObject({
          error: 'temporarily_unavailable',
        });
      }
    }
    expect(statuses.filter((s) => s === 201)).toHaveLength(20);
    expect(statuses.at(-1)).toBe(429);
    expect(registered()).toBe(20);
  });

  it('counts each address separately', async () => {
    for (let i = 0; i < 20; i += 1) {
      await post(body);
    }
    const again = await post(body);
    expect(again.status).toBe(429);
    const other = await post(body, { 'cf-connecting-ip': '198.51.100.9' });
    expect(other.status).toBe(201);
  });

  it('counts every address of one IPv6 network as the same caller', async () => {
    for (let i = 0; i < 20; i += 1) {
      await post(body, { 'cf-connecting-ip': `2001:db8:1:2:${i}::1` });
    }
    const sameNetwork = await post(body, {
      'cf-connecting-ip': '2001:db8:1:2:ffff::9',
    });
    expect(sameNetwork.status).toBe(429);
    const otherNetwork = await post(body, {
      'cf-connecting-ip': '2001:db8:1:3::1',
    });
    expect(otherNetwork.status).toBe(201);
  });

  it('falls back to X-Forwarded-For when Cloudflare sent no address', async () => {
    const res = await POST(
      new Request('https://app.test/oauth/register', {
        method: 'POST',
        body,
        headers: { 'x-forwarded-for': '192.0.2.44, 10.0.0.1' },
      }),
    );
    expect(res.status).toBe(201);
    expect(
      raw
        .prepare("SELECT key FROM rate_limits WHERE key LIKE '%192.0.2.44'")
        .all(),
    ).toHaveLength(1);
  });
});

describe('OPTIONS /oauth/register', () => {
  it('answers the CORS preflight with 204', () => {
    expect(OPTIONS().status).toBe(204);
  });
});
