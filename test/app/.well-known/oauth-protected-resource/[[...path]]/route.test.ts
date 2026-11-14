import { describe, expect, it } from '@jest/globals';

import {
  GET,
  OPTIONS,
} from '@/app/.well-known/oauth-protected-resource/[[...path]]/route';

const get = (path?: readonly string[]) =>
  GET(
    new Request(
      `https://app.test/.well-known/oauth-protected-resource/${(path ?? []).join('/')}`,
    ),
    { params: Promise.resolve({ path }) },
  );

describe('GET /.well-known/oauth-protected-resource', () => {
  it('describes the MCP endpoint at the bare path', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      resource: 'https://app.test/mcp',
      authorization_servers: ['https://app.test'],
    });
  });

  it('describes the MCP endpoint at its own path', async () => {
    const res = await get(['mcp']);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      resource: 'https://app.test/mcp',
    });
  });

  it.each([['anything'], ['api'], ['api', 'other'], ['mcp', 'x']])(
    'answers 404 for the path /%s',
    async (...path) => {
      const res = await get(path);
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: 'not_found' });
    },
  );
});

describe('OPTIONS /.well-known/oauth-protected-resource', () => {
  it('answers the CORS preflight with 204', () => {
    expect(OPTIONS().status).toBe(204);
  });
});
