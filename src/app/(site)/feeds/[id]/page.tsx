import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import type { ReactElement } from 'react';

import { FeedMetadata } from '@/components/feeds/feed-metadata';
import { FeedRail } from '@/components/feeds/feed-rail';
import { FeedSummary } from '@/components/feeds/feed-summary';
import { feedResource, parseFeedId } from '@/domain/api/feed-resource';
import { getDatabase } from '@/domain/db/database';
import { hostOf } from '@/domain/render/tiers';
import { Repository } from '@/domain/repository';
import { getCurrentUser } from '@/lib/core/auth';

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
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ before?: string }>;
}): Promise<ReactElement> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const id = parseFeedId((await params).id);
  if (id === undefined) notFound();
  const repo = new Repository(getDatabase());
  const [feed, feeds] = await Promise.all([
    repo.getFeed(user.id, id),
    repo.listFeeds(user.id),
  ]);
  if (!feed) notFound();
  const before = parseFeedId((await searchParams).before ?? '');
  const rows = await repo.searchArticles(user.id, {
    feed: id,
    ...(before !== undefined ? { before } : {}),
    limit: PAGE_SIZE,
  });
  const stories = rows.slice(0, PAGE_SIZE);
  const last = stories.at(-1);
  const metadataElements = feedResource(feed).metadata;

  return (
    <div className="reader">
      <FeedRail feeds={feeds} current={id} />
      <div className="panel">
        <FeedSummary feed={feed} heading />
        <section aria-labelledby="stories">
          <h2 id="stories">Stories</h2>
          {stories.length ? (
            <ol className="feeditems">
              {stories.map((s) => (
                <li key={s.id}>
                  <a href={`/article/${s.id}`}>{s.title || hostOf(s.url)}</a>
                  <div className="u">
                    {[
                      s.source,
                      s.published_at ? s.published_at.slice(0, 10) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}{' '}
                    ·{' '}
                    <a href={s.url} target="_blank" rel="noopener noreferrer">
                      Original ↗
                    </a>
                  </div>
                  {s.summary ? <p>{s.summary.slice(0, 280)}</p> : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">
              No stories kept from this feed yet. They appear after the next
              fetch.
            </p>
          )}
          <p className="pager">
            {before !== undefined ? (
              <a className="btn ghost small" href={`/feeds/${id}`}>
                ← Newest
              </a>
            ) : null}{' '}
            {rows.length > PAGE_SIZE && last ? (
              <a
                className="btn ghost small"
                href={`/feeds/${id}?before=${last.id}`}
              >
                Older →
              </a>
            ) : null}
          </p>
        </section>
        <section aria-labelledby="about">
          <h2 id="about">Everything this feed says about itself</h2>
          {metadataElements.length ? (
            <FeedMetadata elements={metadataElements} />
          ) : (
            <p className="muted">Shown after the feed is next fetched.</p>
          )}
        </section>
      </div>
    </div>
  );
}
