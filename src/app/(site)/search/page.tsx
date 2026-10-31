import type { Metadata } from 'next';
import type { ReactElement } from 'react';

import { ensurePublicUser } from '@/domain/account';
import { parseArticleQuery } from '@/domain/api/article-resource';
import { getDatabase } from '@/domain/db/database';
import { hostOf } from '@/domain/render/tiers';
import { Repository } from '@/domain/repository';
import { getCurrentUser } from '@/lib/core/auth';
import { encodeCursor } from '@/lib/core/api';

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
    <div className="searchpage">
      <h1 className="deskhead">Search the archive</h1>
      <form className="searchform" action="/search" method="get" role="search">
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
          className="focus-ring"
        />
        <button type="submit" className="listen">
          Search
        </button>
      </form>
      {!input.ok ? (
        <p className="secdesc">That search could not be read.</p>
      ) : query.q && !items.length ? (
        <p className="secdesc">No stories hold every one of those words.</p>
      ) : null}
      <ol className="results">
        {items.map((a) => (
          <li key={a.id} className="result">
            <div className="kicker">
              {a.source || hostOf(a.url)}
              {a.edition ? <span className="score">{a.edition}</span> : null}
            </div>
            <a className="hl focus-ring" href={`/article/${a.id}`}>
              {a.title}
            </a>
            {a.summary ? <p className="ex">{a.summary}</p> : null}
            <a
              className="more focus-ring"
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Original ↗
            </a>
          </li>
        ))}
      </ol>
      {older ? (
        <p>
          <a className="more focus-ring" href={older}>
            Older results →
          </a>
        </p>
      ) : null}
    </div>
  );
}
