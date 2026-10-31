import type { TrendingArticle } from '@/domain/repository';

/**
 * The "Most read" column: the stories from the reader's sources that most
 * people opened this week, with how many did. Only the count shows, never
 * who.
 */
export function MostRead({
  stories,
}: Readonly<{ stories: readonly TrendingArticle[] }>) {
  if (!stories.length) return null;
  return (
    <aside className="editors-note" aria-label="Most read">
      <h2>Most read</h2>
      <ol>
        {stories.map(({ article, count }) => (
          <li key={article.id}>
            <a href={`/article/${article.id}`}>
              {article.title ?? article.url}
            </a>{' '}
            <span className="muted">
              {count} {count === 1 ? 'reader' : 'readers'}
            </span>
          </li>
        ))}
      </ol>
    </aside>
  );
}
