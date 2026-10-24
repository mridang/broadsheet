import { describe, expect, it } from '@jest/globals';
import { NextResponse } from 'next/server';

import { SESSION_COOKIE, sessionClaims } from '@/domain/auth/app';
import { SessionTokens } from '@/lib/session';
import { setSessionCookie } from '@/core/auth/session-cookie';
import type { User } from '@/domain/auth/store';

const SECRET = 'test-session-secret-value';
const user = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 7,
    email: 'a@b.com',
    name: 'Ada Lovelace',
    picture: null,
    refresh_token_enc: null,
    session_epoch: 0,
    recipes_folder_id: null,
    ...overrides,
  }) as unknown as User;

async function issued(
  u: User,
  options: {
    claims?: Record<string, string | number | boolean>;
    exp?: number;
  } = {},
) {
  const response = NextResponse.next();
  await setSessionCookie(response, u, {
    secret: SECRET,
    secure: true,
    ...options,
  });
  const cookie = response.cookies.get(SESSION_COOKIE);
  return {
    cookie,
    payload: await new SessionTokens(SECRET).verify(cookie!.value),
  };
}

describe('setSessionCookie', () => {
  it('sets a signed, httpOnly cookie carrying who the person is', async () => {
    const { cookie, payload } = await issued(user());
    expect(cookie).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    });
    expect(cookie?.secure).toBe(true);
    expect(payload).toMatchObject({
      uid: 7,
      email: 'a@b.com',
      name: 'Ada Lovelace',
    });
  });

  it('is not Secure over plain http (local development)', async () => {
    const response = NextResponse.next();
    await setSessionCookie(response, user(), {
      secret: SECRET,
      secure: false,
    });
    expect(response.cookies.get(SESSION_COOKIE)?.secure).toBe(false);
  });

  it("carries the app's usual extra claims unless told otherwise", async () => {
    const u = user({ recipes_folder_id: 'folder-1' });
    expect((await issued(u)).payload).toMatchObject(sessionClaims(u));
    expect(
      (await issued(u, { claims: { custom: 'yes' } })).payload,
    ).toMatchObject({ custom: 'yes', uid: 7 });
    expect(
      (await issued(u, { claims: { custom: 'yes' } })).payload,
    ).not.toHaveProperty('drive');
  });

  it("stamps the session with the account's epoch, so signing out everywhere can end it", async () => {
    expect((await issued(user({ session_epoch: 4 }))).payload?.ep).toBe(4);
  });

  it('keeps an existing expiry, so correcting a hint never lengthens a session', async () => {
    const soon = Math.floor(Date.now() / 1000) + 3600;
    expect((await issued(user(), { exp: soon })).payload?.exp).toBe(soon);
  });

  it('starts a full session when no expiry is given', async () => {
    const { payload } = await issued(user());
    expect(payload!.exp).toBeGreaterThan(
      Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 29,
    );
  });
});
