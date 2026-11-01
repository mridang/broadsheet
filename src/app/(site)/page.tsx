import type { Metadata } from 'next';

import { ensurePublicUser } from '@/domain/account';
import { getCurrentUser } from '@/lib/core/auth';
import { getDatabase } from '@/domain/db/database';
import { Repository } from '@/domain/repository';
import { todayEdition } from '@/domain/scraping/index';
import { sqliteSince, WINDOWS } from '@/domain/api/article-resource';
import { parseFeedId } from '@/domain/api/feed-resource';
import {
  editionIssueFor,
  issueArticles,
  issueFor,
  storedEditionIssue,
  storedIssue,
} from '@/domain/issues';
import { FrontPage } from '@/app/(site)/_components/front-page';
import { Paper } from '@/app/(site)/_components/paper';
import { loadPersonal } from '@/app/(site)/_components/personal';
import { ReadTracker } from '@/app/(site)/_components/read-tracker';
import { EditionBar } from '@/app/(site)/_components/edition-bar';
import { EditionSwitcher } from '@/app/(site)/_components/edition-switcher';
import { MostRead } from '@/app/(site)/_components/most-read';
import { Rivers } from '@/app/(site)/_components/rivers';
import { frontPageRivers } from '@/domain/rivers';
import { KeyboardShortcuts } from '@/app/(site)/_components/keyboard-shortcuts';
import { TopicPicker } from '@/app/(site)/_components/topic-picker';
import { TOPICS } from '@/domain/topics';
import { buttonClass } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/notice';
import { PageHeader } from '@/components/ui/page-header';

export const dynamic = 'force-dynamic';

/**
 * The front page is the one public page: the title, description and social card
 * come from the root layout, and the page opts in to being indexed (the
 * Worker's `PUBLIC_PAGES` and robots.txt agree). Back issues live at
 * `/edition/{date}`; `?edition={id}` shows one of the reader's custom editions
 * instead of the daily paper.
 */
export const metadata: Metadata = { robots: { index: true, follow: true } };

/** How many stories the "Most read" column lists. */
const MOST_READ = 5;

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ edition?: string }>;
}) {
  const { edition: editionParam } = await searchParams;
  const user = await getCurrentUser();
  const repo = new Repository(getDatabase());
  // Logged-out visitors read the hidden public user's Hacker News edition.
  const ownerId = user ? user.id : await ensurePublicUser();

  // Muted feeds stay followed but drop out of the paper.
  const feeds = (await repo.listFeeds(ownerId)).filter((f) => !f.muted);
  if (!feeds.length) {
    if (user && !(await repo.listFeeds(user.id)).length) {
      return (
        <div className="max-w-3xl">
          <PageHeader title="Welcome" />
          <div className="mt-6">
            <TopicPicker topics={TOPICS} />
          </div>
        </div>
      );
    }
    return (
      <div className="max-w-3xl">
        <EmptyState
          title="No feeds yet"
          action={
            <a className={buttonClass({})} href="/feeds">
              Manage feeds →
            </a>
          }
        >
          Sign in and add some feeds to build your paper.
        </EmptyState>
      </div>
    );
  }

  // A custom edition the reader owns, when one is asked for.
  const papers = user ? await repo.listCustomEditions(user.id) : [];
  const paperId = parseFeedId(editionParam ?? '');
  const paper = papers.find((p) => p.id === paperId);

  // Today's stored issue when the daily run has laid it out; else the most
  // recent edition, laid out live.
  const editions = await repo.listEditions(ownerId);
  const today = todayEdition();
  const stored = paper
    ? await storedEditionIssue(repo, paper.id, today)
    : await storedIssue(repo, ownerId, today);
  const selected = stored ? today : (editions[0] ?? today);
  const issue = paper
    ? await editionIssueFor(repo, paper, selected)
    : await issueFor(repo, ownerId, selected, user?.id);
  const personal = user ? await loadPersonal(repo, user.id) : undefined;
  const rivers = user
    ? await frontPageRivers(getDatabase(), user.id)
    : undefined;
  const mostRead = (
    await repo.trendingArticles(ownerId, {
      order: 'reads',
      since: sqliteSince(new Date(), WINDOWS.week),
      limit: MOST_READ,
    })
  ).slice(0, MOST_READ);

  return (
    <FrontPage
      title={paper?.name ?? (user ? 'Your paper' : 'Today’s paper')}
      description={
        user
          ? 'Personalised from your feeds, laid out every morning.'
          : 'The Hacker News edition, laid out every morning.'
      }
      bar={<EditionBar selected={selected} editions={editions} />}
      switcher={
        user ? (
          <EditionSwitcher
            editions={papers.map((p) => ({ id: p.id, name: p.name }))}
            selected={paper?.id}
          />
        ) : null
      }
      side={
        mostRead.length || rivers ? (
          <>
            {mostRead.length ? <MostRead stories={mostRead} /> : null}
            {rivers ? <Rivers {...rivers} /> : null}
          </>
        ) : undefined
      }
    >
      <KeyboardShortcuts />
      {personal?.markReadOnOpen ? <ReadTracker /> : null}
      <Paper
        layout={issue.layout}
        articles={await issueArticles(repo, issue.layout)}
        briefing={issue.briefing}
        personal={personal}
      />
    </FrontPage>
  );
}
