import { describe, expect, it } from '@jest/globals';
import { z } from 'zod';

import { JsonClient } from '@/lib/http';

const Thing = z.object({ id: z.number(), name: z.string() });

/** A fetcher that answers one canned response and records the URL it saw. */
function fetcherOf(
  body: string,
  status = 200,
): { fetcher: typeof fetch; seen: string[] } {
  const seen: string[] = [];
  const fetcher = ((url: URL | RequestInfo) => {
    seen.push(String(url));
    return Promise.resolve(new Response(body, { status }));
  }) as unknown as typeof fetch;
  return { fetcher, seen };
}

describe('JsonClient.request', () => {
  it('builds the URL from base + path + query and decodes a valid body', async () => {
    const { fetcher, seen } = fetcherOf(JSON.stringify({ id: 1, name: 'a' }));
    const client = new JsonClient('https://api.test/v1', fetcher);
    const result = await client.request(
      { path: '/thing', query: { q: 'x' } },
      Thing,
    );
    expect(seen[0]).toBe('https://api.test/v1/thing?q=x');
    expect(result).toEqual({
      ok: true,
      value: { id: 1, name: 'a' },
      raw: '{"id":1,"name":"a"}',
      status: 200,
    });
  });

  it('fails with the status on a non-2xx response', async () => {
    const { fetcher } = fetcherOf('nope', 503);
    const result = await new JsonClient('https://api.test', fetcher).request(
      { path: '/x' },
      Thing,
    );
    expect(result).toMatchObject({ ok: false, error: 'http 503', status: 503 });
  });

  it('fails when the body is not JSON', async () => {
    const { fetcher } = fetcherOf('<html>', 200);
    const result = await new JsonClient('https://api.test', fetcher).request(
      { path: '/x' },
      Thing,
    );
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ status: 200, raw: '<html>' });
  });

  it('fails when the JSON does not match the schema', async () => {
    const { fetcher } = fetcherOf(JSON.stringify({ id: 'no' }), 200);
    const result = await new JsonClient('https://api.test', fetcher).request(
      { path: '/x' },
      Thing,
    );
    expect(result.ok).toBe(false);
  });

  it('fails without a status when the fetch itself throws', async () => {
    const fetcher = (() =>
      Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    const result = await new JsonClient('https://api.test', fetcher).request(
      { path: '/x' },
      Thing,
    );
    expect(result).toEqual({
      ok: false,
      error: 'offline',
      raw: '',
      status: undefined,
    });
  });
});
