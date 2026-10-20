import type { Metadata } from 'next';

import { ensurePublicUser } from '@/lib/account';
import { getCurrentUser } from '@/lib/auth/current-user';
import { getDatabase } from '@/lib/util';
import { feedArticles, listEditions, listFeeds } from '@/lib/repository';
import { todayEdition } from '@/lib/scraping';
import { Section } from './_components/section';
import { EditionBar } from './_components/edition-bar';

export const dynamic = 'force-dynamic';

/**
 * The front page is the one public page: the title, description and social card
 * come from the root layout, and the page opts in to being indexed (the
 * Worker's `PUBLIC_PAGES` and robots.txt agree). It names no canonical address,
 * as `?date=` shows a different edition.
 */
export const metadata: Metadata = { robots: { index: true, follow: true } };

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date } = await searchParams;
  const user = await getCurrentUser();
  const database = getDatabase();
  // Logged-out visitors read the hidden public user's Hacker News edition.
  const ownerId = user ? user.id : await ensurePublicUser();

  const feeds = await listFeeds(database, ownerId);
  if (!feeds.length) {
    return (
      <div className="panel">
        <h2>No feeds yet</h2>
        <p className="muted">Sign in and add some feeds to build your paper.</p>
        <p>
          <a className="btn" href="/feeds">
            Manage feeds →
          </a>
        </p>
      </div>
    );
  }

  // Every day's scrape is its own edition; all are kept. Pick the requested
  // day if it exists, else the most recent.
  const editions = await listEditions(database, ownerId);
  const selected =
    date && editions.includes(date) ? date : (editions[0] ?? todayEdition());

  const sections = await Promise.all(
    feeds.map(async (feed) => ({
      feed,
      articles: await feedArticles(database, feed.id, selected),
    })),
  );

  return (
    <>
      <EditionBar selected={selected} editions={editions} />
      {sections.map(({ feed, articles }) => (
        <Section key={feed.id} feed={feed} articles={articles} />
      ))}
      <div className="foot">
        THE HACKER TIMES — auto-generated from your feeds, refreshed daily.
        Every day is archived.
      </div>
      <div className="enginenote">
        Generative layout: weight → tier → copyfit, with an In Brief rail for
        the low-weight tail.
      </div>
    </>
  );
}
