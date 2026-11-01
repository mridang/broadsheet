import type { Metadata } from 'next';
import { TextLink } from '@/components/ui/button';
import { notFound, redirect } from 'next/navigation';

import { getCurrentUser } from '@/lib/core/auth';
import { getDatabase } from '@/domain/db/database';
import { Repository } from '@/domain/repository';
import { parseBriefedStories } from '@/domain/briefing';
import { briefingResource } from '@/domain/api/briefing-resource';
import {
  groupBySection,
  paragraphs,
  sectionHeading,
  writtenWith,
} from '@/app/(site)/briefings/_components/briefing-view';
import { StoryRow } from '@/components/stories/story-row';
import { CARD } from '@/components/ui/field';
import { ErrorText } from '@/components/ui/notice';
import { PageHeader, PageSection } from '@/components/ui/page-header';

export const dynamic = 'force-dynamic';

/** The tab title of one briefing. */
export const metadata: Metadata = { title: 'Briefing' };

/**
 * One briefing as a page to read: its title and when it is for, the editor's
 * note in paragraphs, then the stories it covers under their sections, each
 * marked when the person has read it, and how it was written.
 */
export default async function BriefingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const { id } = await params;
  if (!/^[1-9]\d{0,14}$/.test(id)) notFound();
  const repo = new Repository(getDatabase());
  const stored = await repo.getBriefing(user.id, Number(id));
  if (!stored) notFound();
  const [rows, reads] = await Promise.all([
    repo.articlesByIds(parseBriefedStories(stored.stories).map((s) => s.id)),
    repo.readState(user.id),
  ]);
  const articles = new Map(rows.map((a) => [a.id, a]));
  const b = briefingResource(stored, articles, reads.ids);
  const note = paragraphs(b.summary);
  const small = writtenWith(b);

  return (
    <article className="max-w-3xl">
      <TextLink
        tone="muted"
        href="/briefings"
        className="text-sm font-medium print:hidden"
      >
        ← All briefings
      </TextLink>
      <PageHeader
        className="mt-4"
        title={b.title}
        description={`${b.local_date} · ${b.slot} · ${b.frequency} briefing`}
      />
      {b.status === 'failed' ? (
        <ErrorText>
          This briefing could not be written
          {b.error ? `: ${b.error}` : '.'}
        </ErrorText>
      ) : null}
      {note.length ? (
        <div
          className={`${CARD} mt-8 space-y-4 p-6 font-serif text-base leading-relaxed text-ink sm:text-lg`}
        >
          {note.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      ) : null}
      {groupBySection(b.stories, b.sections).map(({ category, stories }) => (
        <PageSection
          key={category}
          id={`section-${category}`}
          title={sectionHeading(category)}
        >
          <ul className="divide-y divide-line border-y border-line">
            {stories.map((s) => {
              const a = articles.get(Number(s.article_id));
              return (
                <StoryRow
                  key={s.article_id}
                  story={{
                    href: s.url ?? `/article/${s.article_id}`,
                    external: Boolean(s.url),
                    title: s.title || s.url || 'Untitled story',
                    meta: [s.source, s.read ? 'Read' : 'Unread'],
                    excerpt: a?.summary,
                    image: a?.image,
                  }}
                >
                  {a?.body_text ? (
                    <a
                      className="focus-ring rounded-sm text-sm font-medium text-subtle hover:text-ink"
                      href={`/article/${s.article_id}`}
                    >
                      Full text
                    </a>
                  ) : null}
                </StoryRow>
              );
            })}
          </ul>
        </PageSection>
      ))}
      {small ? <p className="mt-10 text-xs text-subtle">{small}</p> : null}
    </article>
  );
}
