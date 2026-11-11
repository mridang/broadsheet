import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/lib/core/auth';
import { getDatabase } from '@/domain/db/database';
import { parseFeedId } from '@/domain/api/feed-resource';
import { Repository } from '@/domain/repository';
import { ShareRepository } from '@/domain/shares';
import { ago, hostOf } from '@/domain/render/tiers';
import { storedDate } from '@/lib/intl';
import { ShareButton } from '@/app/(site)/_components/share-button';
import { StoryRow } from '@/components/stories/story-row';
import { EmptyState } from '@/components/ui/notice';
import { PageHeader } from '@/components/ui/page-header';
import { Tabs } from '@/components/ui/tabs';
import { TextLink } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

/** The tab title of the shared stories. */
export const metadata: Metadata = { title: 'Shared stories' };

/** How many shares a page shows. */
const PAGE = 20;

/**
 * The stories people shared, newest first, as NewsBlur's global shared
 * stories: everyone's, the person's own (`?user=self`) or one sharer's
 * (`?user={id}`), each with its sharer's name and comment, paged by
 * `?before={share id}`. The person can share or unshare a story from their
 * own feeds here too.
 */
export default async function SharedPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ user?: string; before?: string }>;
}>) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const query = await searchParams;
  const sharer =
    query.user === 'self' ? user.id : parseFeedId(query.user ?? '');
  const before = parseFeedId(query.before ?? '');
  const db = getDatabase();
  const [rows, mine] = await Promise.all([
    new ShareRepository(db).list({
      limit: PAGE,
      ...(sharer === undefined ? {} : { userIds: [sharer] }),
      ...(before === undefined ? {} : { before }),
    }),
    new Repository(db).sharedArticleIds(user.id),
  ]);
  const shares = rows.slice(0, PAGE);
  const more = rows.length > PAGE ? shares.at(-1) : undefined;
  const who = query.user === 'self' ? 'self' : sharer;
  const named =
    sharer !== undefined && sharer !== user.id
      ? shares[0]?.sharer.name || 'this reader'
      : undefined;
  const params = (extra: Record<string, string>) =>
    `/shared?${new URLSearchParams({
      ...(who === undefined ? {} : { user: String(who) }),
      ...extra,
    })}`;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={named ? `Shared by ${named}` : 'Shared stories'}
        description="Stories readers passed on, with what they said about them."
      />
      <Tabs
        label="Whose shares"
        className="mt-6"
        tabs={[
          { label: 'Everyone', href: '/shared', current: who === undefined },
          {
            label: 'Yours',
            href: '/shared?user=self',
            current: who === 'self' || sharer === user.id,
          },
        ]}
      />
      {shares.length > 0 ? (
        <ul className="mt-8 divide-y divide-line border-y border-line">
          {shares.map((s) => (
            <StoryRow
              key={s.id}
              story={{
                href: s.article.url,
                external: true,
                title: s.article.title || s.article.url,
                meta: [
                  s.article.source || hostOf(s.article.url),
                  ago(storedDate(s.shared_at ?? '')?.toISOString() ?? null),
                ],
                excerpt: s.article.summary,
                image: s.article.image,
              }}
            >
              <span className="flex min-w-0 basis-full flex-col gap-1">
                <span>
                  Shared by{' '}
                  <TextLink
                    href={
                      s.sharer.id === user.id
                        ? '/shared?user=self'
                        : `/shared?user=${s.sharer.id}`
                    }
                    className="font-medium"
                  >
                    {s.sharer.id === user.id
                      ? 'you'
                      : s.sharer.name || 'a reader'}
                  </TextLink>
                </span>
                {s.comments ? (
                  <q className="block border-l-2 border-accent pl-3 text-ink/90 not-italic">
                    {s.comments}
                  </q>
                ) : null}
              </span>
              {mine.has(s.article.id) ? (
                <ShareButton
                  articleId={s.article.id}
                  shared
                  title={s.article.title ?? ''}
                />
              ) : null}
            </StoryRow>
          ))}
        </ul>
      ) : (
        <div className="mt-8">
          <EmptyState icon="share" title="Nothing shared yet">
            {who === undefined
              ? 'When readers share a story, it shows up here.'
              : 'Share a story from the front page and it shows up here.'}
          </EmptyState>
        </div>
      )}
      <div className="mt-6 flex gap-3 text-sm">
        {before === undefined ? null : (
          <TextLink tone="accent" className="font-medium" href={params({})}>
            ← Newest
          </TextLink>
        )}
        {more ? (
          <TextLink
            tone="accent"
            className="ml-auto font-medium"
            href={params({ before: String(more.id) })}
          >
            Older shares →
          </TextLink>
        ) : null}
      </div>
    </div>
  );
}
