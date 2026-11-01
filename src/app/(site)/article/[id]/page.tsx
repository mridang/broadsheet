import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactElement } from 'react';

import { AskBox } from '@/app/(site)/article/[id]/_components/ask-box';
import { ReadTimer } from '@/app/(site)/article/[id]/_components/read-timer';
import { ensurePublicUser } from '@/domain/account';
import { parseFeedId } from '@/domain/api/feed-resource';
import { getDatabase } from '@/domain/db/database';
import { hostOf } from '@/domain/render/tiers';
import { Repository } from '@/domain/repository';
import { getCurrentUser } from '@/lib/core/auth';
import { withText } from '@/domain/scraping/index';
import { mailtoLink } from '@/domain/api/emails';
import { EmailStoryForm } from '@/app/(site)/article/[id]/_components/email-story-form';
import { ROW_LINK } from '@/components/stories/story-row';
import { ShareButton } from '@/app/(site)/_components/share-button';
import { StoryChanges } from '@/app/(site)/_components/story-changes';
import { hasChanges } from '@/domain/render/changes';
import { TextLink } from '@/components/ui/button';
import { Icon } from '@/components/ui/icons';
import { SectionHeader } from '@/components/ui/page-header';

export const dynamic = 'force-dynamic';

/** Stories are other people's writing: never indexed here. */
export const metadata: Metadata = {
  title: 'Story',
  robots: { index: false, follow: false },
};

/** The day a story was published, or else scraped, written out in full. */
function dateline(published: string | null, edition: string | null): string {
  const ms = Date.parse(published || edition || '');
  return Number.isNaN(ms)
    ? ''
    : new Date(ms).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      });
}

/**
 * One story set in the paper's type: headline, dateline, standfirst and the
 * full text kept from its page, with the original a click away. Shows only
 * stories from the reader's own feeds (a visitor reads the public paper's).
 * A story changed since it was first seen shows what changed. A signed-in
 * reader can share it and ask questions about it. Similar stories from any
 * source follow, linking out to those from feeds the reader does not follow.
 */
export default async function ArticlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactElement> {
  const id = parseFeedId((await params).id);
  if (id === undefined) notFound();
  const user = await getCurrentUser();
  const ownerId = user ? user.id : await ensurePublicUser();
  const db = getDatabase();
  const repo = new Repository(db);
  const stored = await repo.getArticle(ownerId, id);
  if (!stored) notFound();
  const article = await withText(db, stored);
  const similar = (await repo.discoverArticles(ownerId, article.id)) ?? [];
  const paragraphs = (article.body_text ?? '').split('\n\n').filter(Boolean);
  const date = dateline(article.published_at, article.edition);
  const shared = user
    ? (await repo.sharedArticleIds(user.id)).has(article.id)
    : false;

  return (
    <article className="mx-auto max-w-2xl">
      <p className="text-sm font-medium text-subtle">
        {article.source || hostOf(article.url)}
        {date ? <span> · {date}</span> : null}
      </p>
      <h1 className="mt-3 text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl">
        {article.title}
      </h1>
      {article.summary ? (
        <p className="mt-4 text-lg leading-relaxed text-muted">
          {article.summary}
        </p>
      ) : null}
      {hasChanges(article.original_summary, article.summary) ? (
        <StoryChanges
          original={article.original_summary!}
          current={article.summary ?? ''}
        />
      ) : null}
      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-1 border-y border-line py-2 text-sm">
        <TextLink bare className={ROW_LINK} href={article.url}>
          <Icon name="external" className="size-4" />
          Read the original
        </TextLink>
        {user ? (
          <ShareButton
            articleId={article.id}
            shared={shared}
            title={article.title ?? ''}
          />
        ) : null}
        {user ? (
          <EmailStoryForm articleId={article.id} mailto={mailtoLink(article)} />
        ) : (
          <TextLink bare className={ROW_LINK} href={mailtoLink(article)}>
            Email this story
          </TextLink>
        )}
        {article.edition ? (
          <TextLink
            bare
            className={ROW_LINK}
            href={`/edition/${article.edition}`}
          >
            Back to the {article.edition} edition
          </TextLink>
        ) : null}
      </div>
      {paragraphs.length ? (
        <div className="mt-8 space-y-5 font-serif text-lg leading-8 text-ink/90">
          {paragraphs.map((text, i) => (
            <p key={i}>{text}</p>
          ))}
        </div>
      ) : (
        <p className="mt-8 text-muted">
          The full text of this story was not kept.
        </p>
      )}
      {user ? <AskBox id={article.id} /> : null}
      {similar.length ? (
        <section aria-labelledby="similar" className="mt-12">
          <SectionHeader id="similar" title="Similar stories" />
          <ul className="mt-4 divide-y divide-line border-y border-line">
            {similar.map((s) => (
              <li key={s.article.id} className="py-3">
                <p className="text-xs text-subtle">
                  {s.article.source || hostOf(s.article.url)}
                  {s.followed ? '' : ' · not in your feeds'}
                </p>
                <TextLink
                  className="mt-0.5 block text-sm font-medium"
                  href={s.followed ? `/article/${s.article.id}` : s.article.url}
                >
                  {s.article.title || s.article.url}
                </TextLink>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {user ? <ReadTimer id={article.id} /> : null}
    </article>
  );
}
