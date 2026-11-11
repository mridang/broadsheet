import { describe, expect, it } from '@jest/globals';

import {
  GET,
  OPTIONS,
} from '@/app/.well-known/oauth-protected-resource/[[...path]]/route';

const get = (path?: string[]) =>
  GET(new Request('https://app.test/x'), {
    params: Promise.resolve(path ? { path } : {}),
  });

describe('/.well-known/oauth-protected-resource', () => {
  it.each([[undefined], [['mcp']]])(
    'describes the MCP endpoint at %j',
    async (path) => {
      const response = await get(path);
      expect(await response.json()).toMatchObject({
        resource: 'https://app.test/mcp',
        authorization_servers: ['https://app.test'],
      });
    },
  );

  it('has nothing at another path', async () => {
    const res = await get(['api']);
    expect(res.status).toBe(404);
  });

  it('answers the preflight', () => {
    expect(OPTIONS().status).toBe(204);
  });
});
