import { describe, expect, it } from '@jest/globals';
import { NextResponse } from 'next/server';

import { RETURN_COOKIE, STATE_COOKIE } from '../../../src/lib/auth/app';
import {
  finishFlow,
  startFlowCookies,
} from '../../../src/lib/auth/flow-cookies';

const start = (returnTo: string | undefined, secure = true) => {
  const response = NextResponse.next();
  startFlowCookies(response, { state: 'signin.abc', returnTo, secure });
  return response;
};

describe('startFlowCookies', () => {
  it('keeps the state in a short-lived, httpOnly, lax cookie', () => {
    expect(start('/app').cookies.get(STATE_COOKIE)).toMatchObject({
      value: 'signin.abc',
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 600,
      secure: true,
    });
  });

  it('remembers where to land afterwards with the same attributes', () => {
    expect(start('/recipes/add').cookies.get(RETURN_COOKIE)).toMatchObject({
      value: '/recipes/add',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 600,
    });
  });

  it('clears an earlier return path when there is none this time', () => {
    const cookie = start(undefined).cookies.get(RETURN_COOKIE);
    expect(cookie).toMatchObject({ value: '', expires: new Date(0) });
  });

  it('is not Secure over plain http (local development)', () => {
    expect(start('/app', false).cookies.get(STATE_COOKIE)?.secure).toBe(false);
  });
});

describe('finishFlow', () => {
  it('redirects to the path on this site', () => {
    const response = finishFlow('https://app.test', '/app');
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://app.test/app');
  });

  it('clears both one-time cookies', () => {
    const response = finishFlow('https://app.test', '/app');
    expect(response.cookies.get(STATE_COOKIE)).toMatchObject({
      value: '',
      expires: new Date(0),
    });
    expect(response.cookies.get(RETURN_COOKIE)).toMatchObject({
      value: '',
      expires: new Date(0),
    });
  });
});
