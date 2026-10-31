import { describe, expect, it, jest } from '@jest/globals';

import { authenticateMcpRequest, type McpAuthDeps } from '@/domain/mcp/auth';

const ORIGIN = 'https://app.test';
const TOKEN = `bsh_at_${'a'.repeat(43)}`;

const request = (authorization?: string) =>
  new Request(`${ORIGIN}/mcp`, {
    method: 'POST',
    headers: authorization ? { Authorization: authorization } : {},
  });

/** Lookups that know one token for person 7, who may or may not still exist. */
function deps(exists = true) {
  const identify = jest.fn<McpAuthDeps['identify']>(async (token, resource) =>
    token === TOKEN && resource === `${ORIGIN}/mcp`
      ? { userId: 7, grantId: 'g', scope: ['read'] }
      : undefined,
  );
  return {
    identify,
    make: (): McpAuthDeps => ({
      identify,
      userExists: async () => exists,
      now: () => 0,
    }),
  };
}

describe('authenticateMcpRequest', () => {
  it('asks a caller with no token to sign in', async () => {
    expect(
      await authenticateMcpRequest(request(), ORIGIN, deps().make),
    ).toEqual({ kind: 'no-token' });
  });

  it('turns away a token not shaped like ours without a lookup', async () => {
    const d = deps();
    await authenticateMcpRequest(request('Bearer junk'), ORIGIN, d.make);
    expect(d.identify).not.toHaveBeenCalled();
  });

  it('refuses an unknown token', async () => {
    const other = `Bearer bsh_at_${'b'.repeat(43)}`;
    expect(
      await authenticateMcpRequest(request(other), ORIGIN, deps().make),
    ).toEqual({ kind: 'invalid-token' });
  });

  it('refuses the token of an account that is gone', async () => {
    expect(
      await authenticateMcpRequest(
        request(`Bearer ${TOKEN}`),
        ORIGIN,
        deps(false).make,
      ),
    ).toEqual({ kind: 'invalid-token' });
  });

  it('names the person and scope behind a valid token', async () => {
    expect(
      await authenticateMcpRequest(
        request(`Bearer ${TOKEN}`),
        ORIGIN,
        deps().make,
      ),
    ).toEqual({ kind: 'ok', uid: 7, scope: ['read'] });
  });
});
