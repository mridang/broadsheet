import { describe, expect, it } from '@jest/globals';

import {
  GET,
  OPTIONS,
} from '@/app/.well-known/oauth-authorization-server/route';

describe('GET /.well-known/oauth-authorization-server', () => {
  it('describes the endpoints of this origin, publicly', async () => {
    const res = GET(
      new Request('https://app.test/.well-known/oauth-authorization-server'),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(await res.json()).toMatchObject({
      issuer: 'https://app.test',
      token_endpoint: 'https://app.test/oauth/token',
      code_challenge_methods_supported: ['S256'],
      client_id_metadata_document_supported: true,
      revocation_endpoint_auth_methods_supported: ['none'],
    });
  });
});

describe('OPTIONS /.well-known/oauth-authorization-server', () => {
  it('answers the CORS preflight with 204', () => {
    expect(OPTIONS().status).toBe(204);
  });
});
