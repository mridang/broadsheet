import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { NextResponse } from 'next/server';

import {
  EXTRA_PURPOSES,
  LANDING_PATH,
  RETURN_COOKIE,
  SESSION_COOKIE,
  SIGN_IN_FAILED_PATH,
  STATE_COOKIE,
  sessionClaims,
} from '../../../../../src/lib/auth/app';
import type { User } from '../../../../../src/lib/auth/store';
import { verifySessionToken } from '../../../../../src/lib/auth/session';
import {
  SESSION_SECRET,
  answerFetch,
  appRequest,
  installEnv,
  jar,
} from '../../../../lib/auth/auth-test-kit';

const person = {
  id: 4,
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  picture: null,
  session_epoch: 7,
  refresh_token_enc: null,
  recipes_folder_id: null,
} as unknown as User;

const upsertGoogleUser = jest
  .fn<(profile: unknown) => Promise<User>>()
  .mockResolvedValue(person);
const afterSignIn = jest
  .fn<(user: unknown) => Promise<void>>()
  .mockResolvedValue(undefined);
/** One stand-in flow for each extra ask the app has. */
const completed = jest
  .fn<(...args: unknown[]) => Promise<NextResponse>>()
  .mockResolvedValue(
    NextResponse.redirect('https://app.test/finished-elsewhere'),
  );
const OTHER_FLOWS = Object.fromEntries(
  EXTRA_PURPOSES.map((purpose) => [
    purpose,
    {
      failurePath: (kind: string) => `/failed/${purpose}/${kind}`,
      complete: completed,
    },
  ]),
);

jest.unstable_mockModule('../../../../../src/lib/auth/store', () => ({
  upsertGoogleUser,
}));
jest.unstable_mockModule('../../../../../src/lib/auth/hooks', () => ({
  afterSignIn,
  OTHER_FLOWS,
}));

const { GET } = await import('../../../../../src/app/api/auth/callback/route');

let restore: () => void;

beforeEach(() => {
  jar.clear();
  upsertGoogleUser.mockClear();
  afterSignIn.mockReset();
  afterSignIn.mockResolvedValue(undefined);
  completed.mockClear();
  restore = installEnv();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  restore();
  jest.restoreAllMocks();
});

const STATE = 'signin.abc';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

/** The cookies a browser holds partway through a round trip. */
const trip = (state = STATE, extra: Record<string, string> = {}) => ({
  [STATE_COOKIE]: state,
  ...extra,
});

/** A callback request from Google, from a browser holding `cookies`. */
function callback(query: string, cookies: Record<string, string> = trip()) {
  jar.clear();
  Object.entries(cookies).forEach(([name, value]) => jar.set(name, value));
  return GET(appRequest('GET', `/api/auth/callback?${query}`));
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });

/** Google answering a successful sign-in. */
function googleSignsIn(email: string | null = 'ada@example.com') {
  return answerFetch({
    [TOKEN_URL]: () => json({ access_token: 'at', expires_in: 3599 }),
    [USERINFO_URL]: () =>
      json({
        sub: 'google-sub-1',
        ...(email === null ? {} : { email }),
        name: 'Ada Lovelace',
        picture: 'https://pics.example/ada',
      }),
  });
}

const where = (res: Response) => res.headers.get('location');
const FAILED = `https://app.test${SIGN_IN_FAILED_PATH}`;

/** Everything the callback set on the response, by cookie name. */
const cookiesOf = (res: NextResponse) =>
  Object.fromEntries(res.cookies.getAll().map((c) => [c.name, c.value]));

describe('GET /api/auth/callback with a state that does not check out', () => {
  it('sends a sign-in back with a fixed flag when there is no state cookie', async () => {
    const res = await callback(`code=c&state=${STATE}`, {});
    expect(where(res)).toBe(FAILED);
  });

  it('sends it back when the state differs from the cookie', async () => {
    const res = await callback(`code=c&state=signin.other`);
    expect(where(res)).toBe(FAILED);
  });

  it('sends it back when the state is not one of ours', async () => {
    const res = await callback(`code=c&state=admin.abc`, trip('admin.abc'));
    expect(where(res)).toBe(FAILED);
  });

  for (const purpose of EXTRA_PURPOSES) {
    it(`sends a ${purpose} round trip back to where that ask reports errors`, async () => {
      const res = await callback(
        `code=c&state=${purpose}.other`,
        trip(`${purpose}.abc`),
      );
      expect(where(res)).toBe(`https://app.test/failed/${purpose}/error`);
    });
  }

  it('never calls Google and leaves the cookies of a real round trip alone', async () => {
    const requested = answerFetch({});
    const res = await callback(`code=c&state=signin.forged`);
    expect(requested).toEqual([]);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(upsertGoogleUser).not.toHaveBeenCalled();
  });
});

describe('GET /api/auth/callback when the person did not approve', () => {
  it('sends a cancelled sign-in back with a fixed flag and clears the round-trip cookies', async () => {
    const requested = answerFetch({});
    const res = await callback(`error=access_denied&state=${STATE}`);
    expect(where(res)).toBe(FAILED);
    expect(res.headers.get('set-cookie')).toContain(`${STATE_COOKIE}=;`);
    expect(requested).toEqual([]);
  });

  for (const purpose of EXTRA_PURPOSES) {
    it(`sends a cancelled ${purpose} round trip back as denied`, async () => {
      const res = await callback(
        `error=access_denied&state=${purpose}.abc`,
        trip(`${purpose}.abc`),
      );
      expect(where(res)).toBe(`https://app.test/failed/${purpose}/denied`);
    });
  }
});

describe('GET /api/auth/callback signing in', () => {
  it('records the person by their Google account and lands on the landing page', async () => {
    googleSignsIn();
    const res = await callback(`code=c&state=${STATE}`);
    expect(where(res)).toBe(`https://app.test${LANDING_PATH}`);
    expect(upsertGoogleUser).toHaveBeenCalledWith({
      sub: 'google-sub-1',
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      picture: 'https://pics.example/ada',
    });
  });

  it('asks Google for the token with the callback address registered for the app', async () => {
    const requested = googleSignsIn();
    await callback(`code=the-code&state=${STATE}`);
    expect(requested).toEqual([`POST ${TOKEN_URL}`, `GET ${USERINFO_URL}`]);
  });

  it('issues a signed session for the person, stamped with their epoch and the app’s claims', async () => {
    googleSignsIn();
    const res = await callback(`code=c&state=${STATE}`);
    const session = await verifySessionToken(
      cookiesOf(res)[SESSION_COOKIE] ?? '',
      SESSION_SECRET,
    );
    expect(session).toMatchObject({
      uid: 4,
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      ep: 7,
      ...sessionClaims(person),
    });
  });

  it('sets a cookie that is httpOnly, Lax and Secure on https', async () => {
    googleSignsIn();
    const res = await callback(`code=c&state=${STATE}`);
    expect(res.cookies.get(SESSION_COOKIE)).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      path: '/',
    });
  });

  it('runs the app’s hook for the person who signed in, before the session is issued', async () => {
    googleSignsIn();
    await callback(`code=c&state=${STATE}`);
    expect(afterSignIn).toHaveBeenCalledWith(person);
  });

  it('clears the one-time cookies once the trip is over', async () => {
    googleSignsIn();
    const res = await callback(`code=c&state=${STATE}`);
    const header = res.headers.get('set-cookie') ?? '';
    expect(header).toContain(`${STATE_COOKIE}=;`);
    expect(header).toContain(`${RETURN_COOKIE}=;`);
  });

  it('lands on the safe returnTo the trip began with', async () => {
    googleSignsIn();
    const res = await callback(
      `code=c&state=${STATE}`,
      trip(STATE, { [RETURN_COOKIE]: '/somewhere/else' }),
    );
    expect(where(res)).toBe('https://app.test/somewhere/else');
  });

  it('ignores a returnTo cookie that points off the site', async () => {
    googleSignsIn();
    const res = await callback(
      `code=c&state=${STATE}`,
      trip(STATE, { [RETURN_COOKIE]: '//evil.example' }),
    );
    expect(where(res)).toBe(`https://app.test${LANDING_PATH}`);
  });

  it('fails the sign-in when Google shares no email address', async () => {
    googleSignsIn(null);
    const res = await callback(`code=c&state=${STATE}`);
    expect(where(res)).toBe(FAILED);
    expect(res.cookies.get(SESSION_COOKIE)).toBeUndefined();
    expect(upsertGoogleUser).not.toHaveBeenCalled();
  });

  it('fails the sign-in, showing nothing Google said, when the code is refused', async () => {
    answerFetch({ [TOKEN_URL]: () => json({ error: 'invalid_grant' }, 400) });
    const res = await callback(`code=bad&state=${STATE}`);
    expect(where(res)).toBe(FAILED);
    expect(res.cookies.get(SESSION_COOKIE)).toBeUndefined();
    expect(upsertGoogleUser).not.toHaveBeenCalled();
  });

  it('fails the sign-in, issuing no session, when the app’s hook fails', async () => {
    googleSignsIn();
    afterSignIn.mockRejectedValue(new Error('boom'));
    const res = await callback(`code=c&state=${STATE}`);
    expect(where(res)).toBe(FAILED);
    expect(res.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });
});

describe('GET /api/auth/callback on a server that is not set up', () => {
  it('fails closed without a session secret: no code is spent and no session is issued', async () => {
    restore();
    restore = installEnv({
      GOOGLE_OAUTH_CLIENT_ID: 'client-id',
      GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret',
    });
    const requested = googleSignsIn();
    const res = await callback(`code=c&state=${STATE}`);
    expect(where(res)).toBe(FAILED);
    expect(requested).toEqual([]);
    expect(upsertGoogleUser).not.toHaveBeenCalled();
    expect(res.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });

  it('fails closed without the Google client, too', async () => {
    restore();
    restore = installEnv({ SESSION_SECRET });
    const requested = googleSignsIn();
    const res = await callback(`code=c&state=${STATE}`);
    expect(where(res)).toBe(FAILED);
    expect(requested).toEqual([]);
  });
});

for (const purpose of EXTRA_PURPOSES) {
  describe(`GET /api/auth/callback finishing a ${purpose} round trip`, () => {
    it('hands the round trip to that ask’s own flow, not to sign-in', async () => {
      googleSignsIn();
      const res = await callback(
        `code=c&state=${purpose}.abc`,
        trip(`${purpose}.abc`),
      );
      expect(where(res)).toBe('https://app.test/finished-elsewhere');
      expect(completed).toHaveBeenCalledTimes(1);
      expect(upsertGoogleUser).not.toHaveBeenCalled();
      expect(afterSignIn).not.toHaveBeenCalled();
    });

    it('sends the person to where that ask reports errors when its flow fails', async () => {
      googleSignsIn();
      completed.mockRejectedValueOnce(new Error('boom'));
      const res = await callback(
        `code=c&state=${purpose}.abc`,
        trip(`${purpose}.abc`),
      );
      expect(where(res)).toBe(`https://app.test/failed/${purpose}/error`);
    });
  });
}
