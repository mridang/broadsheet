import { describe, expect, it } from '@jest/globals';

import {
  bearerToken,
  formFailure,
  noStoreJson,
  oauthError,
  preflight,
  readOAuthForm,
} from '@/lib/oauth/http';

describe('bearerToken', () => {
  it('reads the token', () => {
    const request = new Request('https://a.test', {
      headers: { Authorization: 'Bearer abc' },
    });
    expect(bearerToken(request)).toBe('abc');
  });

  it('is undefined for another scheme', () => {
    const request = new Request('https://a.test', {
      headers: { Authorization: 'Basic abc' },
    });
    expect(bearerToken(request)).toBeUndefined();
  });
});

describe('responses', () => {
  it('answers a preflight with 204 and CORS', () => {
    const response = preflight();
    expect([
      response.status,
      response.headers.get('access-control-allow-origin'),
    ]).toEqual([204, '*']);
  });

  it('never lets a token response be stored', () => {
    expect(noStoreJson({}).headers.get('cache-control')).toBe('no-store');
  });

  it('shapes an OAuth error', async () => {
    expect(await oauthError('invalid_grant', 'No.').json()).toEqual({
      error: 'invalid_grant',
      error_description: 'No.',
    });
  });
});

describe('readOAuthForm', () => {
  it('reads a URL-encoded form', async () => {
    const form = await readOAuthForm(
      new Request('https://a.test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'a=1',
      }),
    );
    expect(form.kind === 'ok' && form.form.get('a')).toBe('1');
  });

  it('refuses JSON', async () => {
    const form = await readOAuthForm(
      new Request('https://a.test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }),
    );
    expect(form.kind).toBe('wrong-type');
  });
});

describe('formFailure', () => {
  it.each(['wrong-type', 'too-large', 'unreadable'] as const)(
    'answers %s with 400',
    (kind) => {
      expect(formFailure({ kind }).status).toBe(400);
    },
  );
});
