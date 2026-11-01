import type { SavedSearch } from '@/domain/repository';
import { RemoveSearchButton } from '@/app/(site)/search/_components/remove-search-button';

/** Where a saved search runs: the search page with its words and feed. */
export function searchHref(search: Pick<SavedSearch, 'query' | 'feed_id'>) {
  const params = new URLSearchParams({ q: search.query });
  if (search.feed_id !== null) params.set('feed_id', String(search.feed_id));
  return `/search?${params}`;
}

/** The person's saved searches, each a link that runs it again. */
export function SavedSearches({
  searches,
}: Readonly<{ searches: readonly SavedSearch[] }>) {
  if (!searches.length) return null;
  return (
    <nav aria-label="Saved searches">
      <ul>
        {searches.map((s) => (
          <li key={s.id}>
            <a href={searchHref(s)}>{s.query}</a>{' '}
            <RemoveSearchButton id={s.id} />
          </li>
        ))}
      </ul>
    </nav>
  );
}
