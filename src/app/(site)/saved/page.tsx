import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/lib/core/auth';
import { getDatabase } from '@/domain/db/database';
import { Repository } from '@/domain/repository';
import { hostOf } from '@/domain/render/tiers';
import { StoryActions } from '@/app/(site)/_components/story-actions';

export const dynamic = 'force-dynamic';

/** The tab title of the saved stories. */
export const metadata: Metadata = { title: 'Saved stories' };

/** The stories the person kept, newest first, narrowed by `?tag=`. */
export default async function SavedPage({
  searchParams,
}: {
  searchParams: Promise<{ tag?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const { tag } = await searchParams;
  const saves = await new Repository(getDatabase()).listSaves(user.id, tag);

  return (
    <div className="panel">
      <h2>Saved stories{tag ? ` tagged “${tag}”` : ''}</h2>
      {tag ? (
        <p>
          <a href="/saved">All saved stories</a>
        </p>
      ) : null}
      {saves.length ? (
        <ul className="saved">
          {saves.map(({ article, tags }) => (
            <li key={article.id}>
              <a href={article.url} target="_blank" rel="noopener noreferrer">
                {article.title || article.url}
              </a>{' '}
              <span className="muted">
                {article.source || hostOf(article.url)}
              </span>
              {tags.map((t) => (
                <a
                  key={t}
                  className="tag"
                  href={`/saved?tag=${encodeURIComponent(t)}`}
                >
                  {t}
                </a>
              ))}
              <StoryActions
                articleId={article.id}
                source={article.source || hostOf(article.url)}
                saved
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">
          Nothing saved yet. Press Save on a story to keep it here.
        </p>
      )}
    </div>
  );
}
