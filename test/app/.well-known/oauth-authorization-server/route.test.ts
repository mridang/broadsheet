import { describe, expect, it } from '@jest/globals';

import {
  GET,
  OPTIONS,
} from '@/app/.well-known/oauth-authorization-server/route';

describe('/.well-known/oauth-authorization-server', () => {
  it('describes this origin as the issuer', async () => {
    const response = GET(new Request('https://app.test/x'));
    expect(await response.json()).toMatchObject({
      issuer: 'https://app.test',
      token_endpoint: 'https://app.test/oauth/token',
    });
  });

  it('answers the preflight', () => {
    expect(OPTIONS().status).toBe(204);
  });
});
