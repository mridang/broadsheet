import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import type { ReactElement } from 'react';

import { FeedMetadata } from '@/components/feeds/feed-metadata';
import { FeedSummary } from '@/components/feeds/feed-summary';
import { feedResource, parseFeedId } from '@/domain/api/feed-resource';
import { getDatabase } from '@/domain/db/client';
import { ago, hostOf } from '@/domain/render/tiers';
import { Repository } from '@/domain/repository';
import { getCurrentUser } from '@/lib/core/auth';
import { StoryRow, ROW_LINK } from '@/components/stories/story-row';
import { buttonClass } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/notice';
import { PageSection } from '@/components/ui/page-header';

export const dynamic = 'force-dynamic';

/** Stories listed per page of one feed. */
const PAGE_SIZE = 30;

/** The tab title of a feed's page. */
export const metadata: Metadata = { title: 'Feed' };

/**
 * One feed's page: everything the feed says about itself, then every story
 * kept from it, newest first, a page at a time (`?before=` the last id shown).
 */
export default async function FeedPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<{ before?: string }>;
}>): Promise<ReactElement> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const route = await params;
  const id = parseFeedId(route.id);
  if (id === undefined) notFound();
  const repo = new Repository(getDatabase());
  const feed = await repo.getFeed(user.id, id);
  if (!feed) notFound();
  const query = await searchParams;
  const before = parseFeedId(query.before ?? '');
  const rows = await repo.searchArticles(user.id, {
    feed: id,
    byDate: true,
    ...(before === undefined ? {} : { before }),
    limit: PAGE_SIZE,
  });
  const stories = rows.slice(0, PAGE_SIZE);
  const last = stories.at(-1);
  const metadataElements = feedResource(feed).metadata;

  return (
    <div className="max-w-3xl">
      <FeedSummary feed={feed} heading />
      <PageSection id="stories" title="Stories">
        {stories.length > 0 ? (
          <ol className="divide-y divide-line border-y border-line">
            {stories.map((s) => (
              <StoryRow
                key={s.id}
                story={{
                  href: `/article/${s.id}`,
                  title: s.title || hostOf(s.url),
                  meta: [s.source, ago(s.published_at)],
                  excerpt: s.summary ? s.summary.slice(0, 280) : null,
                  image: s.image,
                }}
              >
                <a
                  className={ROW_LINK}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Original ↗
                </a>
              </StoryRow>
            ))}
          </ol>
        ) : (
          <EmptyState icon="rss" title="No stories kept from this feed yet">
            They appear after the next fetch.
          </EmptyState>
        )}
        <p className="mt-6 flex gap-2">
          {before === undefined ? null : (
            <a
              className={buttonClass({ variant: 'outline', size: 'sm' })}
              href={`/feeds/${id}`}
            >
              ← Newest
            </a>
          )}{' '}
          {rows.length > PAGE_SIZE && last ? (
            <a
              className={buttonClass({ variant: 'outline', size: 'sm' })}
              href={`/feeds/${id}?before=${last.id}`}
            >
              Older →
            </a>
          ) : null}
        </p>
      </PageSection>
      <PageSection id="about" title="Everything this feed says about itself">
        {metadataElements.length > 0 ? (
          <FeedMetadata elements={metadataElements} />
        ) : (
          <p className="text-sm text-muted">
            Shown after the feed is next fetched.
          </p>
        )}
      </PageSection>
    </div>
  );
}
