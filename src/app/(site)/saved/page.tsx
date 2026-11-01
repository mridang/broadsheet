import type { Metadata } from 'next';
import { Badge, CHIP } from '@/components/ui/badge';
import { TextLink } from '@/components/ui/button';
import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/lib/core/auth';
import { getDatabase } from '@/domain/db/database';
import { Repository } from '@/domain/repository';
import { hostOf } from '@/domain/render/tiers';
import { TagControls } from '@/app/(site)/saved/_components/tag-controls';
import {
  SaveButton,
  StoryActions,
} from '@/app/(site)/_components/story-actions';
import { Icon } from '@/components/ui/icons';
import { MENU_TRIGGER, Menu } from '@/components/ui/menu';
import { StoryRow } from '@/components/stories/story-row';
import { EmptyState } from '@/components/ui/notice';
import { PageHeader } from '@/components/ui/page-header';

export const dynamic = 'force-dynamic';

/** The tab title of the saved stories. */
export const metadata: Metadata = { title: 'Saved stories' };

/**
 * The stories the person kept, newest first, narrowed by `?tag=`, with every
 * tag and its count, and renaming or deleting the tag shown.
 */
export default async function SavedPage({
  searchParams,
}: {
  searchParams: Promise<{ tag?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const { tag } = await searchParams;
  const repo = new Repository(getDatabase());
  const [saves, tags] = await Promise.all([
    repo.listSaves(user.id, tag || undefined),
    repo.savedTagCounts(user.id),
  ]);

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={`Saved stories${tag ? ` tagged “${tag}”` : ''}`}
        description={
          tag ? (
            <TextLink tone="accent" href="/saved">
              All saved stories
            </TextLink>
          ) : (
            'The stories you kept, newest first.'
          )
        }
      />
      {tag ? (
        <div className="mt-6">
          <TagControls tag={tag} />
        </div>
      ) : null}
      {tags.length ? (
        <nav aria-label="Tags" className="mt-6 flex flex-wrap gap-2">
          {tags.map((t) => (
            <TextLink
              bare
              key={t.tag}
              href={`/saved?tag=${encodeURIComponent(t.tag)}`}
              aria-current={t.tag === tag ? 'page' : undefined}
              className={CHIP}
            >
              {t.tag}
              <span className="tabular-nums opacity-70">{t.count}</span>
            </TextLink>
          ))}
        </nav>
      ) : null}
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
                <TextLink
                  bare
                  key={t}
                  className="focus-ring rounded-full"
                  href={`/saved?tag=${encodeURIComponent(t)}`}
                >
                  <Badge>{t}</Badge>
                </TextLink>
              ))}
              <span className="ml-auto flex items-center gap-1">
                <SaveButton
                  articleId={article.id}
                  saved
                  title={article.title ?? ''}
                />
                <Menu
                  label="More actions"
                  width="w-72"
                  triggerClassName={MENU_TRIGGER}
                  trigger={<Icon name="more" />}
                >
                  <StoryActions
                    source={article.source || hostOf(article.url)}
                    title={article.title ?? ''}
                  />
                </Menu>
              </span>
            </StoryRow>
          ))}
        </ul>
      ) : (
        <div className="mt-8">
          <EmptyState icon="bookmark" title="Nothing saved yet">
            Press Save on a story to keep it here.
          </EmptyState>
        </div>
      )}
    </div>
  );
}
