import type { Metadata } from 'next';
import type { ReactElement } from 'react';

import { ensurePublicUser } from '@/domain/account';
import { parseArticleQuery } from '@/domain/api/article-resource';
import { getDatabase } from '@/domain/db/database';
import { hostOf } from '@/domain/render/tiers';
import { Repository } from '@/domain/repository';
import { getCurrentUser } from '@/lib/core/auth';
import { encodeCursor } from '@/lib/core/api';
import { StoryRow, ROW_LINK } from '@/components/stories/story-row';
import { buttonClass } from '@/components/ui/button';
import { fieldClass } from '@/components/ui/field';
import { EmptyState } from '@/components/ui/notice';
import { PageHeader } from '@/components/ui/page-header';

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
  searchParams: Promise<{ q?: string; cursor?: string }>;
}): Promise<ReactElement> {
  const { q = '', cursor } = await searchParams;
  const params = new URLSearchParams({ q: String(q) });
  if (cursor) params.set('cursor', String(cursor));
  const input = parseArticleQuery(params);
  const query = input.ok ? input.query : { q: '', limit: 20 };
  const user = await getCurrentUser();
  const ownerId = user ? user.id : await ensurePublicUser();
  const rows = query.q
    ? await new Repository(getDatabase()).searchArticles(ownerId, query)
    : [];
  const items = rows.slice(0, query.limit);
  const last = rows.length > query.limit ? items.at(-1) : undefined;
  const older = last
    ? `/search?${new URLSearchParams({
        q: query.q ?? '',
        cursor: encodeCursor({ key: String(last.id), id: String(last.id) }),
      })}`
    : undefined;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Search the archive"
        description="Every edition of your feeds, back to the first."
      />
      <form
        className="mt-8 flex gap-2"
        action="/search"
        method="get"
        role="search"
      >
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
          className={fieldClass('h-11 flex-1 text-base')}
        />
        <button
          type="submit"
          className={buttonClass({ size: 'wide', className: 'h-11' })}
        >
          Search
        </button>
      </form>
      {!input.ok ? (
        <p className="mt-6 text-sm text-muted">
          That search could not be read.
        </p>
      ) : query.q && !items.length ? (
        <div className="mt-8">
          <EmptyState title="No stories hold every one of those words." />
        </div>
      ) : null}
      {items.length ? (
        <ol className="mt-8 divide-y divide-line border-y border-line">
          {items.map((a) => (
            <StoryRow
              key={a.id}
              story={{
                href: `/article/${a.id}`,
                title: a.title ?? '',
                meta: [a.source || hostOf(a.url), a.edition],
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
        <p className="mt-6">
          <a
            className={buttonClass({
              variant: 'outline',
              size: 'sm',
              className: 'border-line',
            })}
            href={older}
          >
            Older results →
          </a>
        </p>
      ) : null}
    </div>
  );
}
