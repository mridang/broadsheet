import { describe, expect, it } from '@jest/globals';

import { nonceOf } from '../../../src/lib/http/csp';
import { serve, type ServeApp } from '../../../src/lib/http/serve';

const context = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

/** An app that answers with `make` and remembers the requests it was sent. */
function appAnswering(
  make: (request: Request) => Response,
): ServeApp & { readonly seen: Request[] } {
  const seen: Request[] = [];
  return {
    seen,
    fetch: (request) => {
      seen.push(request);
      return make(request);
    },
  };
}

const html = () =>
  new Response('<html></html>', {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });

const get = (pathname: string, headers: Record<string, string> = {}) =>
  new Request(`https://broadsheet.test${pathname}`, { headers });

describe('serve', () => {
  it('gives the app a fresh policy and its nonce, replacing any the caller sent', async () => {
    const app = appAnswering(html);
    await serve(
      get('/', {
        'x-nonce': 'ATTACKER',
        'content-security-policy': "script-src 'nonce-ATTACKER'",
      }),
      {},
      context,
      { app },
    );
    const sent = app.seen[0]!;
    expect(sent.headers.get('x-nonce')).not.toBe('ATTACKER');
    expect(nonceOf(sent.headers.get('content-security-policy')!)).toBe(
      sent.headers.get('x-nonce'),
    );
  });

  it('puts the same policy on an HTML answer, and no report-only one', async () => {
    const app = appAnswering(html);
    const res = await serve(get('/'), {}, context, { app });
    expect(res.headers.get('content-security-policy')).toBe(
      app.seen[0]!.headers.get('content-security-policy'),
    );
    expect(res.headers.has('content-security-policy-report-only')).toBe(false);
  });

  it('adds the security headers to every answer', async () => {
    const res = await serve(get('/api/health'), {}, context, {
      app: appAnswering(() => new Response('{}')),
    });
    expect(res.headers.get('strict-transport-security')).toContain(
      'max-age=63072000',
    );
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('reporting-endpoints')).toBe(
      'csp-endpoint="/api/csp-reports"',
    );
  });

  it('sends no policy with an answer that is not a page', async () => {
    const res = await serve(get('/api/health'), {}, context, {
      app: appAnswering(
        () =>
          new Response('{}', {
            headers: { 'content-type': 'application/json' },
          }),
      ),
    });
    expect(res.headers.has('content-security-policy-report-only')).toBe(false);
  });

  it('keeps a policy the app set itself', async () => {
    const res = await serve(get('/'), {}, context, {
      app: appAnswering(
        () =>
          new Response('x', {
            headers: {
              'content-type': 'text/html',
              'content-security-policy': "frame-ancestors 'none'",
            },
          }),
      ),
    });
    expect(res.headers.get('content-security-policy')).toBe(
      "frame-ancestors 'none'",
    );
  });

  it('uses a different nonce for every request', async () => {
    const app = appAnswering(html);
    await serve(get('/'), {}, context, { app });
    await serve(get('/'), {}, context, { app });
    expect(app.seen[0]!.headers.get('x-nonce')).not.toBe(
      app.seen[1]!.headers.get('x-nonce'),
    );
  });
});
