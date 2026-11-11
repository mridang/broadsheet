import type { Metadata } from 'next';
import type { ReactElement } from 'react';

import { ensurePublicUser } from '@/domain/account';
import { parseArticleQuery } from '@/domain/api/article-resource';
import { getDatabase } from '@/domain/db/database';
import { ago, hostOf } from '@/domain/render/tiers';
import { Repository } from '@/domain/repository';
import { getCurrentUser } from '@/lib/core/auth';
import { encodeCursor } from '@/lib/core/api';
import { StoryRow, ROW_LINK } from '@/components/stories/story-row';
import { buttonClass } from '@/components/ui/button';
import { EmptyState, Notice } from '@/components/ui/notice';
import { PageHeader } from '@/components/ui/page-header';
import { SaveSearchButton } from '@/app/(site)/search/_components/save-search-button';
import { SavedSearches } from '@/app/(site)/search/_components/saved-searches';

export const dynamic = 'force-dynamic';

/** Search results depend on the query and the reader: never indexed. */
export const metadata: Metadata = {
  title: 'Search',
  robots: { index: false, follow: false },
};

/**
 * Search every edition of the reader's feeds (a visitor searches the public
 * paper). The form is a plain GET, so a search is a link; older results page
 * on with the same cursor the API uses.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cursor?: string; feed_id?: string }>;
}): Promise<ReactElement> {
  const { q = '', cursor, feed_id: feedId } = await searchParams;
  const params = new URLSearchParams({ q: String(q) });
  if (cursor) params.set('cursor', String(cursor));
  if (feedId) params.set('feed_id', String(feedId));
  const input = parseArticleQuery(params);
  const query = input.ok ? input.query : { q: '', limit: 20 };
  const user = await getCurrentUser();
  const ownerId = user ? user.id : await ensurePublicUser();
  const rows = query.q
    ? await new Repository(getDatabase()).searchArticles(ownerId, query)
    : [];
  const saved = user
    ? await new Repository(getDatabase()).listSearches(user.id)
    : [];
  const items = rows.slice(0, query.limit);
  const last = rows.length > query.limit ? items.at(-1) : undefined;
  const older = last
    ? `/search?${new URLSearchParams({
        q: query.q ?? '',
        ...(query.feed === undefined ? {} : { feed_id: String(query.feed) }),
        cursor: encodeCursor({ key: String(last.id), id: String(last.id) }),
      })}`
    : undefined;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Search the archive"
        description="Every edition of your feeds, back to the first."
      />
      <form className="flex gap-2" action="/search" method="get" role="search">
        <label htmlFor="q" className="sr-only">
          Words to find
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={query.q}
          maxLength={200}
          placeholder="Words in a headline or story"
          className="min-w-0 flex-1"
        />
        <button type="submit" className={buttonClass({ size: 'wide' })}>
          Search
        </button>
      </form>
      <SavedSearches searches={saved} />
      {user && input.ok && query.q ? (
        <SaveSearchButton
          query={query.q}
          {...(query.feed === undefined ? {} : { feedId: String(query.feed) })}
        />
      ) : null}
      {input.ok ? (
        query.q && items.length === 0 ? (
          <EmptyState
            icon="search"
            title="No stories hold every one of those words."
          />
        ) : null
      ) : (
        <Notice tone="danger">That search could not be read.</Notice>
      )}
      {items.length > 0 ? (
        <ol className="divide-y divide-line border-y border-line">
          {items.map((a) => (
            <StoryRow
              key={a.id}
              story={{
                href: `/article/${a.id}`,
                title: a.title ?? '',
                meta: [
                  a.source || hostOf(a.url),
                  ago(a.published_at || a.edition),
                ],
                excerpt: a.summary,
                image: a.image,
              }}
            >
              <a
                className={ROW_LINK}
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Original ↗
              </a>
            </StoryRow>
          ))}
        </ol>
      ) : null}
      {older ? (
        <p>
          <a
            className={buttonClass({ variant: 'outline', size: 'sm' })}
            href={older}
          >
            Older results →
          </a>
        </p>
      ) : null}
    </div>
  );
}
