/**
 * @packageDocumentation
 *
 * App glue tying sessions, the database, and the scrape pipeline together:
 * the current signed-in user, session cookies, default-feed seeding for new
 * users, and the hidden public system user that backs the logged-out edition.
 */
import { cookies } from 'next/headers';

import {
  addFeed,
  getUser,
  listFeeds,
  upsertUser,
  type Feed,
  type User,
} from './repository';
import { refreshFeed } from './scraping';
import { cookie, secretOf, sign, unsign } from './session';
import { getDatabase, getEnv, runInBackground } from './util';

const DEFAULT_FEEDS: [string, string][] = [
  ['https://hnrss.org/frontpage', 'Hacker News'],
  ['https://simonwillison.net/atom/everything/', 'Simon Willison'],
  ['https://jvns.ca/atom.xml', 'Julia Evans'],
];
// Feeds shown to logged-out visitors — a normal Hacker News paper.
const PUBLIC_FEEDS: [string, string][] = [
  ['https://hnrss.org/frontpage', 'Hacker News'],
  ['https://hnrss.org/best', 'HN — Best of the Week'],
];

export const SESSION_COOKIE = 'ht_sess';

export const isSecure = (): boolean =>
  (getEnv().BASE_URL ?? '').startsWith('https');

export const devLoginOn = (): boolean =>
  getEnv().ALLOW_DEV_LOGIN === '1' ||
  !(getEnv().GOOGLE_CLIENT_ID && getEnv().GOOGLE_CLIENT_SECRET);

/** Resolve the current signed-in user from the session cookie, or null. */
export async function currentUser(): Promise<User | null> {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!value) return null;
  const id = await unsign(secretOf(getEnv()), value);
  if (!id) return null;
  return (await getUser(getDatabase(), Number(id))) ?? null;
}

/** A signed `Set-Cookie` string establishing the session for `userId`. */
export const sessionCookie = async (userId: number): Promise<string> =>
  cookie(SESSION_COOKIE, await sign(secretOf(getEnv()), String(userId)), {
    maxAge: 30 * 86400,
    secure: isSecure(),
  });

export const clearSessionCookie = (): string =>
  cookie(SESSION_COOKIE, '', { maxAge: 0, secure: isSecure() });

const OAUTH_COOKIE = 'ht_oauth';

/** Sign the OAuth CSRF `state` into a short-lived cookie. */
export const oauthStateCookie = async (state: string): Promise<string> =>
  cookie(OAUTH_COOKIE, await sign(secretOf(getEnv()), state), {
    maxAge: 600,
    secure: isSecure(),
  });

/** Recover the signed OAuth `state` from the request cookies, or null. */
export async function readOAuthState(): Promise<string | null> {
  const v = (await cookies()).get(OAUTH_COOKIE)?.value;
  return v ? unsign(secretOf(getEnv()), v) : null;
}

export const clearOAuthCookie = (): string =>
  cookie(OAUTH_COOKIE, '', { maxAge: 0, secure: isSecure() });

/** Seed a new user's default feeds and warm them in the background. */
export async function seedDefaults(userId: number): Promise<void> {
  const database = getDatabase();
  if ((await listFeeds(database, userId)).length) return;
  const added: Feed[] = [];
  for (const [url, title] of DEFAULT_FEEDS) {
    const f = await addFeed(database, userId, url, title);
    if (f) added.push(f);
  }
  warm(added);
}

/** The logged-out edition is backed by a hidden system user. Returns its id. */
export async function ensurePublicUser(): Promise<number> {
  const database = getDatabase();
  const u = await upsertUser(database, {
    sub: '__public__',
    email: 'public',
    name: 'Hacker News',
    picture: '',
  });
  if (!(await listFeeds(database, u.id)).length) {
    const added: Feed[] = [];
    for (const [url, title] of PUBLIC_FEEDS) {
      const f = await addFeed(database, u.id, url, title);
      if (f) added.push(f);
    }
    warm(added);
  }
  return u.id;
}

/** Refresh feeds in the background (doesn't block the response). */
function warm(feeds: Feed[]): void {
  if (!feeds.length) return;
  runInBackground(
    Promise.all(
      feeds.map((f) =>
        refreshFeed(getDatabase(), getEnv(), f).catch(() => undefined),
      ),
    ),
  );
}
