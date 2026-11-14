/**
 * @packageDocumentation
 *
 * App glue tying the database and the scrape pipeline to people: default-feed
 * seeding for new users, and the hidden public system user that backs the
 * logged-out edition. Who is signed in, and signing in itself, live in
 * `auth/`.
 */
import { Repository, type Feed } from '@/domain/repository';
import { refreshSource } from '@/domain/scraping/index';
import { getEnv, runInBackground } from '@/lib/core/runtime';
import { getDatabase } from '@/domain/db/client';

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
  const repo = new Repository(getDatabase());
  const existing = await repo.listFeeds(userId);
  if (existing.length > 0) return;
  const added: Feed[] = [];
  for (const [url, title] of DEFAULT_FEEDS) {
    const f = await repo.addFeed(userId, url, title);
    if (f) added.push(f);
  }
  warm(added);
}

/** The logged-out edition is backed by a hidden system user. Returns its id. */
export async function ensurePublicUser(): Promise<number> {
  const repo = new Repository(getDatabase());
  const u = await repo.upsertUser({
    sub: '__public__',
    email: 'public',
    name: 'Hacker News',
    picture: '',
  });
  const existing = await repo.listFeeds(u.id);
  if (existing.length === 0) {
    const added: Feed[] = [];
    for (const [url, title] of PUBLIC_FEEDS) {
      const f = await repo.addFeed(u.id, url, title);
      if (f) added.push(f);
    }
    warm(added);
  }
  return u.id;
}

/** Refresh feeds in the background (doesn't block the response). */
function warm(feeds: Feed[]): void {
  if (feeds.length === 0) return;
  runInBackground(
    Promise.all(
      feeds.map((f) =>
        refreshSource(getDatabase(), getEnv(), {
          id: f.source_id,
          url: f.url,
        }).catch(() => undefined),
      ),
    ),
  );
}
