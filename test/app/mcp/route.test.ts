import { describe, expect, it } from '@jest/globals';

import { GET, OPTIONS, POST } from '@/app/mcp/route';

describe('/mcp', () => {
  it('challenges a caller with no token', async () => {
    const response = await POST(
      new Request('https://app.test/mcp', { method: 'POST', body: '{}' }),
    );
    expect(response.status).toBe(401);
  });

  it('refuses a token that is not ours', async () => {
    const response = await GET(
      new Request('https://app.test/mcp', {
        headers: { Authorization: 'Bearer junk' },
      }),
    );
    expect(response.headers.get('www-authenticate')).toContain(
      'error="invalid_token"',
    );
  });

  it('answers the preflight', async () => {
    const response = await OPTIONS(
      new Request('https://app.test/mcp', { method: 'OPTIONS' }),
    );
    expect(response.status).toBe(204);
  });
});
