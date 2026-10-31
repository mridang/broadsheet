import type { Metadata } from 'next';

import { ensurePublicUser } from '@/domain/account';
import { getCurrentUser } from '@/lib/core/auth';
import { getDatabase } from '@/domain/db/database';
import { Repository } from '@/domain/repository';
import { todayEdition } from '@/domain/scraping/index';
import { Section } from '@/app/(site)/_components/section';
import { EditionBar } from '@/app/(site)/_components/edition-bar';
import { KeyboardShortcuts } from '@/app/(site)/_components/keyboard-shortcuts';
import { LegalLinks } from '@/app/(site)/_components/legal-links';

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
  const repo = new Repository(getDatabase());
  // Logged-out visitors read the hidden public user's Hacker News edition.
  const ownerId = user ? user.id : await ensurePublicUser();

  // Muted feeds stay followed but drop out of the paper.
  const feeds = (await repo.listFeeds(ownerId)).filter((f) => !f.muted);
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
  const editions = await repo.listEditions(ownerId);
  const selected =
    date && editions.includes(date) ? date : (editions[0] ?? todayEdition());

  const desks = await Promise.all(
    feeds.map(async (feed) => ({
      feed,
      articles: await repo.sourceArticles(feed.source_id, selected),
    })),
  );
  // Feeds filed under a section print under its heading, in section order;
  // the rest lead the paper with no heading of their own.
  const sections = await repo.listSections(ownerId);
  const groups = [
    { id: null, name: null },
    ...sections.map((s) => ({ id: s.id, name: s.name })),
  ]
    .map((group) => ({
      ...group,
      desks: desks.filter(({ feed }) =>
        group.id === null
          ? !sections.some((s) => s.id === feed.section_id)
          : feed.section_id === group.id,
      ),
    }))
    .filter((group) => group.desks.length);

  return (
    <>
      <EditionBar selected={selected} editions={editions} />
      <KeyboardShortcuts />
      {groups.map((group) => (
        <div key={group.id ?? 'unfiled'}>
          {group.name ? <h2 className="deskhead">{group.name}</h2> : null}
          {group.desks.map(({ feed, articles }) => (
            <Section key={feed.id} feed={feed} articles={articles} />
          ))}
        </div>
      ))}
      <div className="foot">
        THE HACKER TIMES — auto-generated from your feeds, refreshed daily.
        Every day is archived.
        <LegalLinks />
      </div>
      <div className="enginenote">
        Generative layout: weight → tier → copyfit, with an In Brief rail for
        the low-weight tail.
      </div>
    </>
  );
}
