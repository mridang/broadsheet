import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactElement } from 'react';

import { AskBox } from '@/app/(site)/article/[id]/_components/ask-box';
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
 * A signed-in reader can ask questions about it.
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
  const stored = await new Repository(db).getArticle(ownerId, id);
  if (!stored) notFound();
  const article = await withText(db, stored);
  const paragraphs = (article.body_text ?? '').split('\n\n').filter(Boolean);
  const date = dateline(article.published_at, article.edition);

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
      <div className="mt-6 flex flex-wrap items-start gap-x-5 gap-y-2 border-y border-line py-3 text-sm">
        <a
          className={ROW_LINK}
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          Read the original ↗
        </a>
        {user ? (
          <EmailStoryForm articleId={article.id} mailto={mailtoLink(article)} />
        ) : (
          <a className={ROW_LINK} href={mailtoLink(article)}>
            Email this story
          </a>
        )}
        {article.edition ? (
          <a className={ROW_LINK} href={`/edition/${article.edition}`}>
            Back to the {article.edition} edition
          </a>
        ) : null}
      </div>
      {paragraphs.length ? (
        <div className="mt-8 space-y-5 font-(family-name:--font-source-serif) text-lg leading-8 text-ink/90">
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
    </article>
  );
}
