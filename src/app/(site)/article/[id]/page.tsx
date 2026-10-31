import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactElement } from 'react';

import { ensurePublicUser } from '@/domain/account';
import { parseFeedId } from '@/domain/api/feed-resource';
import { getDatabase } from '@/domain/db/database';
import { hostOf } from '@/domain/render/tiers';
import { Repository } from '@/domain/repository';
import { getCurrentUser } from '@/lib/core/auth';

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
  const article = await new Repository(getDatabase()).getArticle(ownerId, id);
  if (!article) notFound();
  const paragraphs = (article.body_text ?? '').split('\n\n').filter(Boolean);
  const date = dateline(article.published_at, article.edition);

  return (
    <article className="story">
      <div className="kicker">
        {article.source || hostOf(article.url)}
        {date ? <span className="score">{date}</span> : null}
      </div>
      <h1 className="story-hl">{article.title}</h1>
      {article.summary ? <p className="story-dek">{article.summary}</p> : null}
      {paragraphs.length ? (
        <div className="story-body">
          {paragraphs.map((text, i) => (
            <p key={i}>{text}</p>
          ))}
        </div>
      ) : (
        <p className="story-dek">The full text of this story was not kept.</p>
      )}
      <p className="story-foot">
        <a
          className="more focus-ring"
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          Read the original ↗
        </a>
        {article.edition ? (
          <a className="more focus-ring" href={`/?date=${article.edition}`}>
            Back to the {article.edition} edition
          </a>
        ) : null}
      </p>
    </article>
  );
}
