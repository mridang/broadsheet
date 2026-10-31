import type { Metadata } from 'next';

import { ensurePublicUser } from '@/domain/account';
import { getCurrentUser } from '@/lib/core/auth';
import { getDatabase } from '@/domain/db/database';
import { Repository } from '@/domain/repository';
import { todayEdition } from '@/domain/scraping/index';
import { issueArticles, issueFor, storedIssue } from '@/domain/issues';
import { Paper } from '@/app/(site)/_components/paper';
import { loadPersonal } from '@/app/(site)/_components/personal';
import { ReadTracker } from '@/app/(site)/_components/read-tracker';
import { EditionBar } from '@/app/(site)/_components/edition-bar';
import { KeyboardShortcuts } from '@/app/(site)/_components/keyboard-shortcuts';
import { TopicPicker } from '@/app/(site)/_components/topic-picker';
import { TOPICS } from '@/domain/topics';

export const dynamic = 'force-dynamic';

/**
 * The front page is the one public page: the title, description and social card
 * come from the root layout, and the page opts in to being indexed (the
 * Worker's `PUBLIC_PAGES` and robots.txt agree). Back issues live at
 * `/edition/{date}`.
 */
export const metadata: Metadata = { robots: { index: true, follow: true } };

export default async function Home() {
  const user = await getCurrentUser();
  const repo = new Repository(getDatabase());
  // Logged-out visitors read the hidden public user's Hacker News edition.
  const ownerId = user ? user.id : await ensurePublicUser();

  // Muted feeds stay followed but drop out of the paper.
  const feeds = (await repo.listFeeds(ownerId)).filter((f) => !f.muted);
  if (!feeds.length) {
    if (user && !(await repo.listFeeds(user.id)).length) {
      return (
        <div className="panel">
          <h2>Welcome</h2>
          <TopicPicker topics={TOPICS} />
        </div>
      );
    }
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

  // Today's stored issue when the daily run has laid it out; else the most
  // recent edition, laid out live.
  const editions = await repo.listEditions(ownerId);
  const today = todayEdition();
  const selected = (await storedIssue(repo, ownerId, today))
    ? today
    : (editions[0] ?? today);
  const issue = await issueFor(repo, ownerId, selected, user?.id);
  const personal = user ? await loadPersonal(repo, user.id) : undefined;

  return (
    <>
      <EditionBar selected={selected} editions={editions} />
      <KeyboardShortcuts />
      {user ? <ReadTracker /> : null}
      <Paper
        layout={issue.layout}
        articles={await issueArticles(repo, issue.layout)}
        briefing={issue.briefing}
        personal={personal}
      />
    </>
  );
}
