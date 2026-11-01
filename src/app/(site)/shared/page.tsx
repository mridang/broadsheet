import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/lib/core/auth';
import { getDatabase } from '@/domain/db/database';
import { parseFeedId } from '@/domain/api/feed-resource';
import { Repository } from '@/domain/repository';
import { ShareRepository } from '@/domain/shares';
import { ago, hostOf } from '@/domain/render/tiers';
import { ShareButton } from '@/app/(site)/_components/share-button';
import { StoryRow } from '@/components/stories/story-row';
import { EmptyState } from '@/components/ui/notice';
import { PageHeader } from '@/components/ui/page-header';
import { cn } from '@/components/ui/cn';

export const dynamic = 'force-dynamic';

/** The tab title of the shared stories. */
export const metadata: Metadata = { title: 'Shared stories' };

/** How many shares a page shows. */
const PAGE = 20;

/** A tab over the shares, as a link that keeps its place in the list. */
const TAB =
  'focus-ring inline-flex h-8 items-center rounded-full border px-3.5 text-sm font-medium';

/**
 * The stories people shared, newest first, as NewsBlur's global shared
 * stories: everyone's, the person's own (`?user=self`) or one sharer's
 * (`?user={id}`), each with its sharer's name and comment, paged by
 * `?before={share id}`. The person can share or unshare a story from their
 * own feeds here too.
 */
export default async function SharedPage({
  searchParams,
}: {
  searchParams: Promise<{ user?: string; before?: string }>;
}) {
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
      ...(sharer !== undefined ? { userIds: [sharer] } : {}),
      ...(before !== undefined ? { before } : {}),
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
      ...(who !== undefined ? { user: String(who) } : {}),
      ...extra,
    })}`;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={named ? `Shared by ${named}` : 'Shared stories'}
        description="Stories readers passed on, with what they said about them."
      />
      <nav aria-label="Whose shares" className="mt-6 flex flex-wrap gap-2">
        {(
          [
            ['/shared', 'Everyone', who === undefined],
            [
              '/shared?user=self',
              'Yours',
              who === 'self' || sharer === user.id,
            ],
          ] as const
        ).map(([href, label, current]) => (
          <Link
            key={href}
            href={href}
            aria-current={current ? 'page' : undefined}
            className={cn(
              TAB,
              current
                ? 'border-ink bg-ink text-on-ink'
                : 'border-line text-muted hover:border-field hover:text-ink',
            )}
          >
            {label}
          </Link>
        ))}
      </nav>
      {shares.length ? (
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
                  s.shared_at ? ago(s.shared_at.replace(' ', 'T') + 'Z') : '',
                ],
                excerpt: s.article.summary,
                image: s.article.image,
              }}
            >
              <span className="flex min-w-0 basis-full flex-col gap-1">
                <span>
                  Shared by{' '}
                  <Link
                    href={
                      s.sharer.id === user.id
                        ? '/shared?user=self'
                        : `/shared?user=${s.sharer.id}`
                    }
                    className="focus-ring rounded-sm font-medium text-ink hover:underline"
                  >
                    {s.sharer.id === user.id
                      ? 'you'
                      : s.sharer.name || 'a reader'}
                  </Link>
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
          <EmptyState title="Nothing shared yet">
            {who === undefined
              ? 'When readers share a story, it shows up here.'
              : 'Share a story from the front page and it shows up here.'}
          </EmptyState>
        </div>
      )}
      <div className="mt-6 flex gap-3 text-sm">
        {before !== undefined ? (
          <Link
            href={params({})}
            className="focus-ring rounded-sm font-medium text-accent hover:underline"
          >
            ← Newest
          </Link>
        ) : null}
        {more ? (
          <Link
            href={params({ before: String(more.id) })}
            className="focus-ring ml-auto rounded-sm font-medium text-accent hover:underline"
          >
            Older shares →
          </Link>
        ) : null}
      </div>
    </div>
  );
}
