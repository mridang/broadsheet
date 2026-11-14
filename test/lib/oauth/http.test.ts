import { describe, expect, it } from '@jest/globals';

import {
  CORS_HEADERS,
  MAX_OAUTH_FORM_BYTES,
  bearerToken,
  formFailure,
  noStoreJson,
  oauthError,
  preflight,
  readOAuthForm,
} from '@/lib/oauth';

const withAuth = (value?: string) =>
  new Request('https://app.test/x', {
    headers: value === undefined ? {} : { authorization: value },
  });

describe('bearerToken', () => {
  it('reads the token from a Bearer header, in any case', () => {
    expect(bearerToken(withAuth('Bearer abc.def'))).toBe('abc.def');
    expect(bearerToken(withAuth('bearer abc'))).toBe('abc');
  });

  it('is undefined without a header or with another scheme', () => {
    expect(bearerToken(withAuth())).toBeUndefined();
    expect(bearerToken(withAuth('Basic abc'))).toBeUndefined();
  });

  it('is undefined for a header with extra words or no token', () => {
    expect(bearerToken(withAuth('Bearer'))).toBeUndefined();
    expect(bearerToken(withAuth('Bearer a b'))).toBeUndefined();
  });
});

describe('CORS_HEADERS', () => {
  const list = (name: string) =>
    (CORS_HEADERS[name] ?? '').split(',').map((v) => v.trim());

  it('allows the methods the endpoints answer, including DELETE so a session-ending client gets our 405', () => {
    expect(list('Access-Control-Allow-Methods')).toEqual([
      'GET',
      'POST',
      'DELETE',
      'OPTIONS',
    ]);
  });

  it('allows the request headers every kind of MCP client sends, spelled as the spec spells them', () => {
    expect(list('Access-Control-Allow-Headers')).toEqual(
      expect.arrayContaining([
        'Authorization',
        'Content-Type',
        'Accept',
        'MCP-Protocol-Version',
        'Mcp-Method',
        'Mcp-Name',
        'Mcp-Session-Id',
        'Last-Event-ID',
        'traceparent',
        'tracestate',
        'baggage',
      ]),
    );
  });

  it('lists no header twice', () => {
    const lower = list('Access-Control-Allow-Headers').map((h) =>
      h.toLowerCase(),
    );
    expect(new Set(lower).size).toBe(lower.length);
  });

  it('lets a page read the challenge and the retry delay', () => {
    expect(list('Access-Control-Expose-Headers')).toEqual([
      'WWW-Authenticate',
      'Retry-After',
    ]);
  });
});

describe('preflight', () => {
  it('answers 204 with the CORS headers', () => {
    const response = preflight();
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-headers')).toBe(
      CORS_HEADERS['Access-Control-Allow-Headers'],
    );
  });
});

describe('noStoreJson', () => {
  it('is never cached, and open to browsers', async () => {
    const response = noStoreJson({ a: 1 });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(await response.json()).toEqual({ a: 1 });
  });

  it('carries a status and extra headers', () => {
    const response = noStoreJson({}, 201, { 'X-Test': '1' });
    expect(response.status).toBe(201);
    expect(response.headers.get('x-test')).toBe('1');
  });
});

describe('oauthError', () => {
  it('is an RFC 6749 error body, 400 unless told otherwise', async () => {
    const response = oauthError('invalid_request', 'Nope.');
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'invalid_request',
      error_description: 'Nope.',
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('can carry another status', () => {
    expect(oauthError('invalid_client', 'x', 401).status).toBe(401);
  });
});

describe('Pragma: no-cache on every JSON answer (RFC 6749 5.1)', () => {
  it('goes with Cache-Control: no-store on successes and errors', () => {
    for (const response of [
      noStoreJson({}),
      oauthError('invalid_request', 'No.'),
    ]) {
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('pragma')).toBe('no-cache');
    }
  });
});

describe('readOAuthForm', () => {
  const post = (body: BodyInit, type?: string) =>
    new Request('https://app.test/oauth/token', {
      method: 'POST',
      body,
      ...(type ? { headers: { 'content-type': type } } : {}),
    });

  it('reads a URL-encoded form', async () => {
    const result = await readOAuthForm(
      post('a=1&b=%20x', 'application/x-www-form-urlencoded; charset=UTF-8'),
    );
    expect(result.kind === 'ok' && result.form.get('b')).toBe(' x');
  });

  it('reads a body that declares no type at all', async () => {
    const bytes = new TextEncoder().encode('a=1');
    const result = await readOAuthForm(post(bytes));
    expect(result.kind === 'ok' && result.form.get('a')).toBe('1');
    const plain = await readOAuthForm(post(new URLSearchParams({ a: '1' })));
    expect(plain.kind).toBe('ok');
  });

  it.each([
    'application/json',
    'multipart/form-data; boundary=x',
    'text/plain',
  ])('refuses a body declared as %s', async (type) => {
    expect(await readOAuthForm(post('a=1', type))).toEqual({
      kind: 'wrong-type',
    });
  });

  it('refuses a form over the limit', async () => {
    const result = await readOAuthForm(
      post(
        `a=${'x'.repeat(MAX_OAUTH_FORM_BYTES)}`,
        'application/x-www-form-urlencoded',
      ),
    );
    expect(result.kind).toBe('too-large');
  });

  it('refuses a body that is not text', async () => {
    const form = await readOAuthForm(post(new Uint8Array([0xff, 0xfe])));
    expect(form.kind).toBe('unreadable');
  });
});

describe('formFailure', () => {
  it.each([
    ['wrong-type', 'Send the request as application/x-www-form-urlencoded.'],
    ['too-large', 'The request is too large.'],
    ['unreadable', 'The request body is not readable.'],
  ] as const)(
    'answers 400 invalid_request for %s',
    async (kind, description) => {
      const response = formFailure({ kind });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: 'invalid_request',
        error_description: description,
      });
    },
  );
});
