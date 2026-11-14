import type { Metadata } from 'next';
import type { ReactElement } from 'react';

import { ensurePublicUser } from '@/domain/account';
import { parseArticleQuery } from '@/domain/api/article-resource';
import { getDatabase } from '@/domain/db/client';
import { Repository, type TrendingOrder } from '@/domain/repository';
import { getCurrentUser } from '@/lib/core/auth';
import { encodeCursor } from '@/lib/core/api';
import { hostOf } from '@/domain/render/tiers';
import { StoryRow } from '@/components/stories/story-row';
import { buttonClass } from '@/components/ui/button';
import { CHECK_LABEL } from '@/components/ui/field';
import { EmptyState } from '@/components/ui/notice';
import { PageHeader } from '@/components/ui/page-header';

export const dynamic = 'force-dynamic';

/** Trending depends on the reader: never indexed. */
export const metadata: Metadata = {
  title: 'Trending',
  robots: { index: false, follow: false },
};

/** The lists, as the page names them. */
const LISTS: readonly (readonly [TrendingOrder, string])[] = [
  ['reads', 'Well read'],
  ['long_reads', 'Long reads'],
  ['good_reads', 'Good reads'],
  ['read_time', 'Most time spent'],
  ['saves', 'Most saved'],
];

/**
 * The trending lists, as NewsBlur has them: the stories from the reader's
 * sources that most people read, read through, read deeply and kept, or
 * saved, over a day, week or month, optionally only the ones the reader has
 * not read. Only counts show, never who. The form is a plain GET, so a list
 * is a link; it pages on with the cursor the API uses.
 */
export default async function TrendingPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | undefined>>;
}>): Promise<ReactElement> {
  const given = await searchParams;
  const params = new URLSearchParams({ order: given['order'] ?? 'reads' });
  for (const key of ['window', 'read', 'sort', 'cursor'] as const) {
    const value = given[key];
    if (value) params.set(key, value);
  }
  const input = parseArticleQuery(params);
  const trending = input.ok ? input.trending : undefined;
  const user = await getCurrentUser();
  const ownerId = user ? user.id : await ensurePublicUser();
  const rows = trending
    ? await new Repository(getDatabase()).trendingArticles(ownerId, {
        ...trending,
        ...(user ? {} : { unread: false }),
      })
    : [];
  const items = rows.slice(0, trending?.limit ?? 0);
  const last =
    trending && rows.length > trending.limit ? items.at(-1) : undefined;
  const more = new URLSearchParams(params);
  if (last) {
    more.set(
      'cursor',
      encodeCursor({ key: String(last.position), id: String(last.article.id) }),
    );
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Trending"
        description="What readers across the paper are reading through, from your sources."
      />
      <form
        className="mt-8 flex flex-wrap items-center gap-2"
        action="/trending"
        method="get"
      >
        <select
          name="order"
          aria-label="List"
          defaultValue={params.get('order') ?? 'reads'}
        >
          {LISTS.map(([order, label]) => (
            <option key={order} value={order}>
              {label}
            </option>
          ))}
        </select>
        <select
          name="window"
          aria-label="Over"
          defaultValue={params.get('window') ?? 'week'}
        >
          <option value="day">Today</option>
          <option value="week">This week</option>
          <option value="month">This month</option>
        </select>
        <select
          name="sort"
          aria-label="From"
          defaultValue={params.get('sort') ?? 'newest'}
        >
          <option value="newest">Top first</option>
          <option value="oldest">Bottom first</option>
        </select>
        {user ? (
          <label className={CHECK_LABEL}>
            <input
              type="checkbox"
              name="read"
              value="false"
              defaultChecked={params.get('read') === 'false'}
            />
            Unread only
          </label>
        ) : null}
        <button type="submit" className={buttonClass({ size: 'wide' })}>
          Show
        </button>
      </form>
      {input.ok && items.length === 0 ? (
        <div className="mt-8">
          <EmptyState icon="trending" title="Nothing is trending here yet." />
        </div>
      ) : null}
      {input.ok ? null : (
        <p className="mt-6 text-sm text-muted">That list could not be read.</p>
      )}
      {items.length > 0 ? (
        <ol className="mt-8 divide-y divide-line border-y border-line">
          {items.map(({ article, count }) => (
            <StoryRow
              key={article.id}
              story={{
                href: `/article/${article.id}`,
                title: article.title ?? article.url,
                meta: [
                  article.source || hostOf(article.url),
                  trending?.order === 'read_time'
                    ? `${Math.round(count / 60)} min read`
                    : `${count} readers`,
                ],
                excerpt: article.summary,
                image: article.image,
              }}
            />
          ))}
        </ol>
      ) : null}
      {last ? (
        <p className="mt-6">
          <a
            className={buttonClass({ variant: 'outline', size: 'sm' })}
            href={`/trending?${more}`}
          >
            More →
          </a>
        </p>
      ) : null}
    </div>
  );
}
