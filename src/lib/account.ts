/**
 * @packageDocumentation
 *
 * App glue tying sessions, the database, and the scrape pipeline together:
 * the current signed-in user, session cookies, default-feed seeding for new
 * users, and the hidden public system user that backs the logged-out edition.
 */
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { cookies } from 'next/headers';

import { createDatabase, type Database, type Feed, type User } from './db';
import { addFeed, getUser, listFeeds, upsertUser } from './repository';
import { refreshFeed } from './scraping';
import { cookie, sign, unsign } from './session';

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

const secret = (env: CloudflareEnv): string =>
  env.SESSION_SECRET || 'dev-insecure-secret-change-me';

/** The Drizzle client bound to the request's D1 binding. */
export const db = (): Database => createDatabase(getCloudflareContext().env.DB);
export const env = (): CloudflareEnv => getCloudflareContext().env;

export const isSecure = (): boolean =>
  (env().BASE_URL ?? '').startsWith('https');

export const devLoginOn = (): boolean =>
  env().ALLOW_DEV_LOGIN === '1' ||
  !(env().GOOGLE_CLIENT_ID && env().GOOGLE_CLIENT_SECRET);

/** Resolve the current signed-in user from the session cookie, or null. */
export async function currentUser(): Promise<User | null> {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!value) return null;
  const id = await unsign(secret(env()), value);
  if (!id) return null;
  return (await getUser(db(), Number(id))) ?? null;
}

/** A signed `Set-Cookie` string establishing the session for `userId`. */
export const sessionCookie = async (userId: number): Promise<string> =>
  cookie(SESSION_COOKIE, await sign(secret(env()), String(userId)), {
    maxAge: 30 * 86400,
    secure: isSecure(),
  });

export const clearSessionCookie = (): string =>
  cookie(SESSION_COOKIE, '', { maxAge: 0, secure: isSecure() });

const OAUTH_COOKIE = 'ht_oauth';

/** Sign the OAuth CSRF `state` into a short-lived cookie. */
export const oauthStateCookie = async (state: string): Promise<string> =>
  cookie(OAUTH_COOKIE, await sign(secret(env()), state), {
    maxAge: 600,
    secure: isSecure(),
  });

/** Recover the signed OAuth `state` from the request cookies, or null. */
export async function readOAuthState(): Promise<string | null> {
  const v = (await cookies()).get(OAUTH_COOKIE)?.value;
  return v ? unsign(secret(env()), v) : null;
}

export const clearOAuthCookie = (): string =>
  cookie(OAUTH_COOKIE, '', { maxAge: 0, secure: isSecure() });

/** Seed a new user's default feeds and warm them in the background. */
export async function seedDefaults(userId: number): Promise<void> {
  const database = db();
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
  const database = db();
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
  const { ctx } = getCloudflareContext();
  ctx.waitUntil(
    Promise.all(
      feeds.map((f) => refreshFeed(db(), env(), f).catch(() => undefined)),
    ),
  );
}
