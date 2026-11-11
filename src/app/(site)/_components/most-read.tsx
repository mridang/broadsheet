import type { TrendingArticle } from '@/domain/repository';
import { countOf } from '@/lib/intl';

/**
 * The "Most read" column: the stories from the reader's sources that most
 * people opened this week, with how many did. Only the count shows, never
 * who.
 */
export function MostRead({
  stories,
}: Readonly<{ stories: readonly TrendingArticle[] }>) {
  if (stories.length === 0) return null;
  return (
    <aside
      className="rounded-card border border-line bg-surface p-5 print:hidden"
      aria-label="Most read"
    >
      <h2 className="text-label font-semibold text-subtle uppercase">
        Most read
      </h2>
      <ol className="mt-3 space-y-4">
        {stories.map(({ article, count }, i) => (
          <li key={article.id} className="flex gap-3">
            <span
              aria-hidden="true"
              className="w-4 shrink-0 text-lg leading-6 font-semibold text-accent tabular-nums"
            >
              {i + 1}
            </span>
            <div className="min-w-0">
              <a
                className="focus-ring rounded-control text-sm leading-snug font-medium text-ink hover:text-accent"
                href={`/article/${article.id}`}
              >
                {article.title ?? article.url}
              </a>{' '}
              <span className="block text-xs text-subtle">
                {countOf(count, 'reader')}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </aside>
  );
}
