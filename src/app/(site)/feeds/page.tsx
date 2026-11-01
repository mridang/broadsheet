import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/lib/core/auth';
import { getDatabase } from '@/domain/db/database';
import { Repository, sectionPath } from '@/domain/repository';
import { FeedSummary } from '@/components/feeds/feed-summary';
import { CARD } from '@/components/ui/field';
import { EmptyState } from '@/components/ui/notice';
import { PageHeader, PageSection } from '@/components/ui/page-header';
import { ROW_LINK } from '@/components/stories/story-row';

import { AddFeedForm } from '@/app/(site)/feeds/_components/add-feed-form';
import { AddSectionForm } from '@/app/(site)/feeds/_components/add-section-form';
import { FeedSettingsForm } from '@/app/(site)/feeds/_components/feed-settings-form';
import { ExportFeedsButton } from '@/app/(site)/feeds/_components/export-feeds-button';
import { FeedHealth } from '@/app/(site)/feeds/_components/feed-health';
import { ImportFeedsForm } from '@/app/(site)/feeds/_components/import-feeds-form';
import { RefreshFeedsButton } from '@/app/(site)/feeds/_components/refresh-feeds-button';
import { RemoveFeedButton } from '@/app/(site)/feeds/_components/remove-feed-button';
import { SuggestedFeeds } from '@/app/(site)/feeds/_components/suggested-feeds';
import { RemoveSectionButton } from '@/app/(site)/feeds/_components/remove-section-button';

export const dynamic = 'force-dynamic';

/** The tab title of the feed manager. */
export const metadata: Metadata = { title: 'Your feeds' };

export default async function FeedsPage({
  searchParams,
}: {
  searchParams: Promise<{
    added?: string;
    skipped?: string;
    rejected?: string;
  }>;
}) {
  const imported = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const repo = new Repository(getDatabase());
  const [feeds, sections, suggestions] = await Promise.all([
    repo.listFeeds(user.id),
    repo.listSections(user.id),
    repo.suggestSources(user.id),
  ]);
  const stats = new Map(
    await Promise.all(
      feeds.map(
        async (f) =>
          [f.id, await repo.feedStatistics(user.id, f.id, 7)] as const,
      ),
    ),
  );
  const options = sections.map((s) => ({
    id: s.id,
    name: sectionPath(sections, s.id),
  }));

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Your feeds"
        description="Feeds are fetched & scraped automatically every day."
        actions={
          <>
            <RefreshFeedsButton /> <ExportFeedsButton />
          </>
        }
      />
      <div className="mt-8">
        <AddFeedForm />
        <ImportFeedsForm />
        {imported.added !== undefined ? (
          <p role="status" className="mt-3 text-sm text-muted">
            Imported {Number(imported.added) || 0} feeds, skipped{' '}
            {Number(imported.skipped) || 0} already followed and rejected{' '}
            {Number(imported.rejected) || 0}.
          </p>
        ) : null}
      </div>
      <ul className="mt-8 space-y-3">
        {feeds.map((f) => (
          <li className={`${CARD} p-5`} key={f.id}>
            <div className="flex items-start gap-4">
              <div className="min-w-0 flex-1">
                <FeedSummary feed={f} />
              </div>
              <RemoveFeedButton id={f.id} />
            </div>
            <div className="mt-4 space-y-3 border-t border-line pt-4">
              <FeedHealth id={f.id} statistics={stats.get(f.id)} />
              <FeedSettingsForm
                id={f.id}
                url={f.url}
                title={f.title ?? ''}
                muted={f.muted}
                sectionId={f.section_id}
                sections={options}
              />
              <a className={ROW_LINK} href={`/feeds/${f.id}`}>
                Stories &amp; details →
              </a>
            </div>
          </li>
        ))}
      </ul>
      {feeds.length ? null : (
        <EmptyState title="No feeds yet">
          Add an RSS/Atom feed URL above.
        </EmptyState>
      )}
      <SuggestedFeeds feeds={suggestions} />
      <PageSection
        id="sections"
        title="Sections"
        description="Sections group feeds under their own headings on the front page."
      >
        <AddSectionForm sections={options} />
        {options.length ? (
          <ul className={`${CARD} mt-4 divide-y divide-line`}>
            {options.map((s) => (
              <li
                className="flex items-center justify-between gap-4 px-5 py-3"
                key={s.id}
              >
                <strong className="text-sm font-semibold">{s.name}</strong>
                <RemoveSectionButton id={s.id} />
              </li>
            ))}
          </ul>
        ) : null}
      </PageSection>
    </div>
  );
}
