import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/lib/core/auth';
import { getDatabase } from '@/domain/db/database';
import { Repository, sectionPath } from '@/domain/repository';
import { FeedRowFacts } from '@/components/feeds/feed-row-facts';
import { FeedIcon, FeedSummary } from '@/components/feeds/feed-summary';
import { countOf } from '@/lib/intl';
import { Badge } from '@/components/ui/badge';
import { TextLink } from '@/components/ui/button';
import { List, ListItem } from '@/components/ui/card';
import { hostOf } from '@/domain/render/tiers';
import { EmptyState } from '@/components/ui/notice';
import { PageHeader, PageSection } from '@/components/ui/page-header';

import { AddFeedForm } from '@/app/(site)/feeds/_components/add-feed-form';
import { AddSectionForm } from '@/app/(site)/feeds/_components/add-section-form';
import { FeedTitleEditor } from '@/app/(site)/feeds/_components/feed-title-editor';
import { FeedSettingsForm } from '@/app/(site)/feeds/_components/feed-settings-form';
import { ExportFeedsButton } from '@/app/(site)/feeds/_components/export-feeds-button';
import {
  FeedHealth,
  isBroken,
} from '@/app/(site)/feeds/_components/feed-health';
import { ImportFeedsForm } from '@/app/(site)/feeds/_components/import-feeds-form';
import { RefreshFeedsButton } from '@/app/(site)/feeds/_components/refresh-feeds-button';
import { RemoveFeedButton } from '@/app/(site)/feeds/_components/remove-feed-button';
import { SuggestedFeeds } from '@/app/(site)/feeds/_components/suggested-feeds';
import { TrendingFeeds } from '@/app/(site)/feeds/_components/trending-feeds';
import { feedVerdictCounts } from '@/domain/classifier-counts';
import { parseSourceQuery } from '@/domain/api/source-resource';
import { RemoveSectionButton } from '@/app/(site)/feeds/_components/remove-section-button';

export const dynamic = 'force-dynamic';

/** The tab title of the feed manager. */
export const metadata: Metadata = { title: 'Your feeds' };

/** How many trending feeds the manager lists. */
const TRENDING_FEEDS = 5;

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
  const followed = new Set(feeds.map((f) => f.url));
  const trendingQuery = parseSourceQuery(
    new URLSearchParams({ order: 'reads' }),
  );
  const trending = trendingQuery.ok
    ? (
        await repo.trendingSources({
          ...trendingQuery.query,
          limit: TRENDING_FEEDS + feeds.length,
        })
      )
        .filter((s) => !followed.has(s.url))
        .slice(0, TRENDING_FEEDS)
        .map((s) => ({ url: s.url, title: s.title, readers: s.count }))
    : [];
  const stats = new Map(
    await Promise.all(
      feeds.map(
        async (f) =>
          [f.id, await repo.feedStatistics(user.id, f.id, 7)] as const,
      ),
    ),
  );
  const [training, prompted] = await Promise.all([
    repo.listClassifiers(user.id),
    repo.promptMatches(user.id),
  ]);
  const counts = new Map(
    await Promise.all(
      feeds.map(
        async (f) =>
          [
            f.id,
            feedVerdictCounts(
              await repo.unreadSourceArticles(user.id, f.source_id),
              f,
              training,
              prompted,
            ),
          ] as const,
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
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <div className="min-w-0 sm:flex-1">
            <AddFeedForm />
          </div>
          <ImportFeedsForm />
        </div>
        {imported.added === undefined ? null : (
          <p role="status" className="mt-3 text-sm text-muted">
            Imported {Number(imported.added) || 0} feeds, skipped{' '}
            {Number(imported.skipped) || 0} already followed and rejected{' '}
            {Number(imported.rejected) || 0}.
          </p>
        )}
      </div>
      {feeds.length > 0 ? (
        <List label="Feeds you follow" className="mt-8">
          {feeds.map((f) => {
            const statistics = stats.get(f.id);
            const stories = statistics
              ? statistics.stories_per_day.reduce((n, d) => n + d.count, 0)
              : 0;
            return (
              <ListItem
                key={f.id}
                leading={<FeedIcon feed={f} />}
                title={
                  <FeedTitleEditor
                    id={f.id}
                    title={f.title ?? ''}
                    name={f.title || hostOf(f.url)}
                  />
                }
                detail={
                  <span className="flex flex-col gap-1">
                    <span>
                      {hostOf(f.url)} · {countOf(stories, 'story', 'stories')}{' '}
                      this week
                    </span>
                    <FeedRowFacts feed={f} />
                  </span>
                }
                actions={
                  <>
                    {statistics && isBroken(statistics) ? (
                      <Badge tone="danger">Failing</Badge>
                    ) : null}
                    {f.muted ? <Badge>Muted</Badge> : null}
                    <RemoveFeedButton id={f.id} />
                  </>
                }
              >
                <details className="group mt-3 sm:pl-11">
                  <summary className="focus-ring inline-flex list-none items-center gap-1 rounded-sm text-xs font-medium text-muted transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
                    Settings &amp; details
                    <span
                      aria-hidden="true"
                      className="transition-transform group-open:rotate-90"
                    >
                      ›
                    </span>
                  </summary>
                  <div className="mt-4 space-y-4 rounded-control bg-ink/3 p-4">
                    <FeedSummary feed={f} />
                    <FeedHealth
                      id={f.id}
                      statistics={statistics}
                      counts={counts.get(f.id)}
                    />
                    <FeedSettingsForm
                      id={f.id}
                      url={f.url}
                      title={f.title ?? ''}
                      muted={f.muted}
                      sectionId={f.section_id}
                      sections={options}
                    />
                    <TextLink
                      href={`/feeds/${f.id}`}
                      tone="muted"
                      className="text-sm"
                    >
                      Stories &amp; details →
                    </TextLink>
                  </div>
                </details>
              </ListItem>
            );
          })}
        </List>
      ) : null}
      {feeds.length > 0 ? null : (
        <EmptyState icon="rss" title="No feeds yet">
          Add an RSS/Atom feed URL above.
        </EmptyState>
      )}
      <SuggestedFeeds feeds={suggestions} />
      <TrendingFeeds feeds={trending} />
      <PageSection
        id="sections"
        title="Sections"
        description="Sections group feeds under their own headings on the front page."
      >
        <AddSectionForm sections={options} />
        {options.length > 0 ? (
          <List label="Sections" className="mt-4">
            {options.map((s) => (
              <ListItem
                key={s.id}
                title={s.name}
                actions={<RemoveSectionButton id={s.id} />}
              />
            ))}
          </List>
        ) : null}
      </PageSection>
    </div>
  );
}
