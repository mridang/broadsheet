import { describe, expect, it } from '@jest/globals';

import { databaseFrom } from '@/domain/db/database';
import type { McpAuth } from '@/domain/mcp/auth';
import { respondToMcp } from '@/domain/mcp/http';
import { APP_MIGRATIONS } from '../../lib/core/db/migrations';
import { sqliteD1 } from '../../lib/core/db/sqlite-d1';

const ORIGIN = 'https://app.test';

/** Answer a request as a caller with this authentication. */
function respond(request: Request, auth: McpAuth): Promise<Response> {
  const db = databaseFrom(sqliteD1(...APP_MIGRATIONS).d1);
  return respondToMcp(
    request,
    ORIGIN,
    async () => auth,
    (uid) => ({ uid, db, refresh: () => undefined }),
  );
}

const reader: McpAuth = { kind: 'ok', uid: 1, scope: ['read'] };
const writer: McpAuth = { kind: 'ok', uid: 1, scope: ['read', 'write'] };

const post = (body: unknown) =>
  new Request(`${ORIGIN}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const call = (name: string, args: Record<string, unknown> = {}) =>
  post({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name, arguments: args },
  });

describe('respondToMcp', () => {
  it('answers a preflight', async () => {
    const response = await respond(
      new Request(`${ORIGIN}/mcp`, { method: 'OPTIONS' }),
      { kind: 'no-token' },
    );
    expect(response.status).toBe(204);
  });

  it('challenges a caller with no token', async () => {
    const response = await respond(post({}), { kind: 'no-token' });
    expect([response.status, response.headers.get('www-authenticate')]).toEqual(
      [
        401,
        'Bearer resource_metadata="https://app.test/.well-known/oauth-protected-resource/mcp", scope="read write"',
      ],
    );
  });

  it('challenges a bad token as invalid', async () => {
    const response = await respond(post({}), { kind: 'invalid-token' });
    expect(response.headers.get('www-authenticate')).toContain(
      'error="invalid_token"',
    );
  });

  it('offers no stream on GET', async () => {
    const response = await respond(new Request(`${ORIGIN}/mcp`), reader);
    expect(response.status).toBe(405);
  });

  it('refuses a body that is not JSON', async () => {
    const response = await respond(post('{'), reader);
    expect(response.status).toBe(400);
  });

  it('refuses JSON that is not a JSON-RPC message', async () => {
    const response = await respond(post({ hello: 1 }), reader);
    expect(response.status).toBe(400);
  });

  it('accepts a notification with 202', async () => {
    const response = await respond(
      post({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      reader,
    );
    expect(response.status).toBe(202);
  });

  it('answers initialize', async () => {
    const response = await respond(
      post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      reader,
    );
    expect(await response.json()).toMatchObject({
      result: { serverInfo: { name: 'broadsheet' } },
    });
  });

  it('lets a read-only grant call a reading tool', async () => {
    const response = await respond(call('list_feeds'), reader);
    expect(await response.json()).toMatchObject({
      result: { structuredContent: { feeds: [], sections: [] } },
    });
  });

  it('asks a read-only grant for write before a changing tool', async () => {
    const response = await respond(
      call('follow_feed', { url: 'https://a.test/f' }),
      reader,
    );
    expect([response.status, response.headers.get('www-authenticate')]).toEqual(
      [403, expect.stringContaining('error="insufficient_scope"')],
    );
  });

  it('lets a write grant call a changing tool', async () => {
    const response = await respond(
      call('unfollow_feed', { feed_id: 1 }),
      writer,
    );
    expect(await response.json()).toMatchObject({
      result: { isError: true },
    });
  });

  it('refuses a grant with no scope at all', async () => {
    const response = await respond(call('list_feeds'), {
      kind: 'ok',
      uid: 1,
      scope: [],
    });
    expect(response.status).toBe(403);
  });
});
