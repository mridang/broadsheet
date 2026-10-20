/**
 * @packageDocumentation
 *
 * App glue tying the database and the scrape pipeline to people: default-feed
 * seeding for new users, and the hidden public system user that backs the
 * logged-out edition. Who is signed in, and signing in itself, live in
 * `auth/`.
 */
import { addFeed, listFeeds, upsertUser, type Feed } from './repository';
import { refreshFeed } from './scraping';
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
