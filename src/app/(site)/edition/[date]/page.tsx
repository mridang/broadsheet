import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ensurePublicUser } from '@/domain/account';
import { getCurrentUser } from '@/lib/core/auth';
import { getDatabase } from '@/domain/db/database';
import { Repository } from '@/domain/repository';
import {
  issueArticles,
  issueFor,
  isIssueDate,
  storedIssue,
} from '@/domain/issues';
import { formatEdition } from '@/domain/render/tiers';
import { FrontPage } from '@/app/(site)/_components/front-page';
import { Paper } from '@/app/(site)/_components/paper';
import { loadPersonal } from '@/app/(site)/_components/personal';
import { ReadTracker } from '@/app/(site)/_components/read-tracker';
import { ScrollReader } from '@/app/(site)/_components/scroll-reader';
import { EditionBar } from '@/app/(site)/_components/edition-bar';
import { KeyboardShortcuts } from '@/app/(site)/_components/keyboard-shortcuts';

export const dynamic = 'force-dynamic';

type Params = Promise<{ date: string }>;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { date } = await params;
  return { title: isIssueDate(date) ? formatEdition(date) : 'Back issue' };
}

/**
 * A back issue: the paper as it was stored for that day, or the day laid out
 * live when the daily run stored none. 404 for a day with no edition.
 */
export default async function Edition({
  params,
}: Readonly<{ params: Params }>) {
  const { date } = await params;
  if (!isIssueDate(date)) notFound();
  const user = await getCurrentUser();
  const repo = new Repository(getDatabase());
  const ownerId = user ? user.id : await ensurePublicUser();
  const editions = await repo.listEditions(ownerId);
  if (!editions.includes(date) && !(await storedIssue(repo, ownerId, date))) {
    notFound();
  }
  const issue = await issueFor(repo, ownerId, date, user?.id);
  const personal = user ? await loadPersonal(repo, user.id) : undefined;

  return (
    <FrontPage
      title="Back issue"
      description={`The paper as it was on ${formatEdition(date)}.`}
      bar={<EditionBar selected={date} editions={editions} />}
    >
      <KeyboardShortcuts />
      {personal?.markReadOnOpen ? <ReadTracker /> : null}
      {personal?.markReadOnScroll ? <ScrollReader /> : null}
      <Paper
        layout={issue.layout}
        articles={await issueArticles(repo, issue.layout)}
        briefing={issue.briefing}
        personal={personal}
      />
    </FrontPage>
  );
}
