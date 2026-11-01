import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/lib/core/auth';
import { getDatabase } from '@/domain/db/database';
import { Repository } from '@/domain/repository';
import { hostOf } from '@/domain/render/tiers';
import { StoryActions } from '@/app/(site)/_components/story-actions';
import { StoryRow } from '@/components/stories/story-row';
import { EmptyState } from '@/components/ui/notice';
import { PageHeader } from '@/components/ui/page-header';

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
    <div className="max-w-3xl">
      <PageHeader
        title={`Saved stories${tag ? ` tagged “${tag}”` : ''}`}
        description={
          tag ? (
            <a
              className="focus-ring rounded-sm font-medium text-accent hover:underline"
              href="/saved"
            >
              All saved stories
            </a>
          ) : (
            'The stories you kept, newest first.'
          )
        }
      />
      {saves.length ? (
        <ul className="mt-8 divide-y divide-line border-y border-line">
          {saves.map(({ article, tags }) => (
            <StoryRow
              key={article.id}
              story={{
                href: article.url,
                external: true,
                title: article.title || article.url,
                meta: [article.source || hostOf(article.url)],
                excerpt: article.summary,
                image: article.image,
              }}
            >
              {tags.map((t) => (
                <a
                  key={t}
                  className="focus-ring rounded-full bg-ink/[0.07] px-2.5 py-0.5 text-xs font-medium text-muted hover:bg-ink/10 hover:text-ink"
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
            </StoryRow>
          ))}
        </ul>
      ) : (
        <div className="mt-8">
          <EmptyState title="Nothing saved yet">
            Press Save on a story to keep it here.
          </EmptyState>
        </div>
      )}
    </div>
  );
}
