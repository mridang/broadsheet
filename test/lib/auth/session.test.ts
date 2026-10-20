import { describe, expect, it } from '@jest/globals';

import { bytesToBase64Url } from '../../../src/lib/util/base64';
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  createSessionToken,
  requireSessionSecret,
  sessionIsCurrent,
  verifySessionToken,
} from '../../../src/lib/auth/session';
import { SESSION_COOKIE as APP_SESSION_COOKIE } from '../../../src/lib/auth/app';

const SECRET = 'test-session-secret-value';

describe('session tokens', () => {
  it('round-trips a valid session', async () => {
    const token = await createSessionToken(
      { uid: 42, email: 'a@b.com' },
      SECRET,
    );
    const payload = await verifySessionToken(token, SECRET);
    expect(payload?.uid).toBe(42);
    expect(payload?.email).toBe('a@b.com');
    expect(payload?.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('carries the extra claims an app adds, and leaves out the undefined ones', async () => {
    const payload = await verifySessionToken(
      await createSessionToken(
        {
          uid: 1,
          email: 'a@b.com',
          hint: true,
          off: false,
          tag: 'x',
          gone: undefined,
        },
        SECRET,
      ),
      SECRET,
    );
    expect(payload).toMatchObject({ hint: true, off: false, tag: 'x' });
    expect(payload).not.toHaveProperty('gone');
  });

  it('rejects a tampered payload', async () => {
    const token = await createSessionToken(
      { uid: 1, email: 'x@y.com' },
      SECRET,
    );
    const [, sig] = token.split('.');
    const forged = `${btoa('{"uid":999,"email":"evil@z.com","exp":9999999999}')
      .replace(/=+$/, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')}.${sig}`;
    expect(await verifySessionToken(forged, SECRET)).toBeNull();
  });

  it('rejects the wrong secret', async () => {
    const token = await createSessionToken(
      { uid: 1, email: 'x@y.com' },
      SECRET,
    );
    expect(await verifySessionToken(token, 'other-secret')).toBeNull();
  });

  it('rejects an expired session', async () => {
    const token = await createSessionToken(
      { uid: 1, email: 'x@y.com', exp: Math.floor(Date.now() / 1000) - 10 },
      SECRET,
    );
    expect(await verifySessionToken(token, SECRET)).toBeNull();
  });

  it('defaults expiry to the configured TTL', async () => {
    const before = Math.floor(Date.now() / 1000);
    const token = await createSessionToken(
      { uid: 1, email: 'x@y.com' },
      SECRET,
    );
    const payload = await verifySessionToken(token, SECRET);
    expect(payload!.exp).toBeGreaterThanOrEqual(
      before + SESSION_TTL_SECONDS - 5,
    );
  });
});

describe('session profile', () => {
  it('carries the name and photo so the header needs no database read', async () => {
    const token = await createSessionToken(
      {
        uid: 1,
        email: 'x@y.com',
        name: 'Ada Lovelace',
        picture: 'https://lh3.googleusercontent.com/a/abc',
      },
      SECRET,
    );
    const payload = await verifySessionToken(token, SECRET);
    expect(payload?.name).toBe('Ada Lovelace');
    expect(payload?.picture).toBe('https://lh3.googleusercontent.com/a/abc');
  });

  it('leaves out a photo address too long for a cookie, and still verifies', async () => {
    const token = await createSessionToken(
      {
        uid: 1,
        email: 'x@y.com',
        picture: `https://x.test/${'a'.repeat(500)}`,
      },
      SECRET,
    );
    const payload = await verifySessionToken(token, SECRET);
    expect(payload?.picture).toBeUndefined();
    expect(payload?.uid).toBe(1);
  });

  it('still accepts a session issued before names were added', async () => {
    const token = await createSessionToken(
      { uid: 7, email: 'old@y.com' },
      SECRET,
    );
    expect((await verifySessionToken(token, SECRET))?.name).toBeUndefined();
  });
});

describe('a correctly signed token with the wrong contents', () => {
  /** Sign `body` (base64url) the way a session token is signed. */
  async function signed(text: string): Promise<string> {
    const body = bytesToBase64Url(new TextEncoder().encode(text));
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = new Uint8Array(
      await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)),
    );
    return `${body}.${bytesToBase64Url(sig)}`;
  }

  it('is refused when the body is not JSON', async () => {
    expect(
      await verifySessionToken(await signed('not json'), SECRET),
    ).toBeNull();
  });

  it('is refused when the body is not an object', async () => {
    for (const text of ['null', '3', '"x"', '[]']) {
      expect(await verifySessionToken(await signed(text), SECRET)).toBeNull();
    }
  });

  it('is refused when it has no expiry', async () => {
    expect(
      await verifySessionToken(await signed('{"uid":1}'), SECRET),
    ).toBeNull();
  });

  it('is accepted once it has an expiry in the future', async () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    expect(
      await verifySessionToken(await signed(`{"uid":1,"exp":${exp}}`), SECRET),
    ).toMatchObject({ uid: 1 });
  });
});

describe('a malformed token', () => {
  it('is refused without a dot, or with an empty signature or a non-base64 one', async () => {
    for (const token of ['', 'abc', '.abc', 'abc.', 'abc.!!!']) {
      expect(await verifySessionToken(token, SECRET)).toBeNull();
    }
  });
});

describe('session epoch', () => {
  it('carries the epoch the session was issued under, and omits it when unknown', async () => {
    const issued = await verifySessionToken(
      await createSessionToken({ uid: 1, email: 'a@b.com', ep: 3 }, SECRET),
      SECRET,
    );
    expect(issued?.ep).toBe(3);
    const legacy = await verifySessionToken(
      await createSessionToken({ uid: 1, email: 'a@b.com' }, SECRET),
      SECRET,
    );
    expect(legacy).not.toHaveProperty('ep');
  });

  it('rejects a signed token whose epoch is not a number', async () => {
    const body = bytesToBase64Url(
      new TextEncoder().encode(
        JSON.stringify({ uid: 1, email: 'a@b.com', ep: '3', exp: 9999999999 }),
      ),
    );
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = bytesToBase64Url(
      new Uint8Array(
        await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)),
      ),
    );
    expect(await verifySessionToken(`${body}.${sig}`, SECRET)).toBeNull();
  });

  it('honours a session only while the database holds the same epoch', () => {
    expect(sessionIsCurrent({ ep: 2 }, 2)).toBe(true);
    expect(sessionIsCurrent({ ep: 2 }, 3)).toBe(false);
  });

  it('treats a session issued before epochs existed as epoch 0', () => {
    expect(sessionIsCurrent({}, 0)).toBe(true);
    expect(sessionIsCurrent({}, 1)).toBe(false);
  });
});

describe('the session cookie', () => {
  it('is named by the app and read from the same place as the tokens', () => {
    expect(SESSION_COOKIE).toBe(APP_SESSION_COOKIE);
  });
});

describe('requireSessionSecret', () => {
  it('hands back a secret that is set', () => {
    expect(requireSessionSecret('s3cret')).toBe('s3cret');
  });

  it('refuses when there is none, rather than falling back to a value anyone could guess', () => {
    expect(() => requireSessionSecret(undefined)).toThrow(/SESSION_SECRET/);
    expect(() => requireSessionSecret('')).toThrow(/SESSION_SECRET/);
  });
});
