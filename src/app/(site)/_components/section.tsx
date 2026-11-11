import { EmptyState } from '@/components/ui/notice';
import { SectionHeader } from '@/components/ui/page-header';
import type { Article } from '@/domain/repository';
import type { LaidDesk } from '@/domain/render/layout';
import {
  hostOf,
  shows,
  verdict,
  type Intelligence,
  type Training,
} from '@/domain/render/tiers';
import { MarkFeedReadButton } from '@/app/(site)/_components/mark-feed-read-button';
import { StoryCard } from '@/app/(site)/_components/story-card';
import { BriefBlock } from '@/app/(site)/_components/brief-block';
import { countOf } from '@/lib/intl';

/** What the reader has done, which shapes their desks. */
export interface Personal {
  readonly training: readonly Training[];
  readonly read: ReadonlySet<number>;
  readonly saved: ReadonlySet<number>;
  readonly shared: ReadonlySet<number>;
  /** Whether a cluster's copies show their picture and opening. */
  readonly clusterExpanded: boolean;
  /** How much of the paper their training lets through. */
  readonly level: Intelligence;
  /** The section each of their feeds is filed under, by feed id. */
  readonly sections: ReadonlyMap<number, number | null>;
  /** Whether opening a story marks it read. */
  readonly markReadOnOpen: boolean;
  /** Whether stories scrolled past are marked read. */
  readonly markReadOnScroll: boolean;
  /** The AI prompt classifiers each story matched, by article id. */
  readonly prompted: ReadonlyMap<number, ReadonlySet<number>>;
}

/**
 * A desk's stories with their articles, in print order, leaving out the ones
 * the reader's intelligence level hides (none without a reader).
 */
export function visibleStories(
  desk: LaidDesk,
  articles: ReadonlyMap<number, Article>,
  personal?: Personal,
) {
  return desk.stories.flatMap((s) => {
    const a = articles.get(s.id);
    if (!a) return [];
    if (!personal) return [{ ...s, a }];
    const v = verdict(
      {
        ...a,
        feed_id: desk.feed_id,
        section_id: personal.sections.get(desk.feed_id) ?? null,
        ...(personal.prompted.has(a.id)
          ? { prompt_ids: personal.prompted.get(a.id)! }
          : {}),
      },
      personal.training,
    );
    return shows(v, personal.level) ? [{ ...s, a }] : [];
  });
}

/**
 * One feed = one desk: its heading, then its stories in the order and at the
 * tiers its layout gives, and the low-weight tail as "In brief". With
 * `personal`, the stories their intelligence level hides are left out, their
 * reads and saves show on the cards, and the desk can be marked read.
 */
export function Section({
  desk,
  articles,
  personal,
}: Readonly<{
  desk: LaidDesk;
  articles: ReadonlyMap<number, Article>;
  personal?: Personal;
}>) {
  const stories = visibleStories(desk, articles, personal);
  const main = stories.flatMap((s) =>
    s.tier === 'brief' ? [] : [{ ...s, tier: s.tier }],
  );
  const briefs = stories.filter((s) => s.tier === 'brief').map((s) => s.a);

  return (
    <section data-desk="" className="mt-12 first:mt-0">
      <SectionHeader
        as="h3"
        className="mb-5 border-b border-line pb-3"
        title={desk.title}
        description={
          <span className="text-subtle">
            {hostOf(desk.url)} · {countOf(stories.length, 'item')}
          </span>
        }
        actions={
          personal ? <MarkFeedReadButton feedId={desk.feed_id} /> : undefined
        }
      />
      {stories.length > 0 ? (
        <div className="grid gap-6 sm:grid-cols-2">
          {main.map((s) => (
            <StoryCard
              key={s.id}
              article={s.a}
              tier={s.tier}
              also={s.also}
              siblings={s.siblings}
              personal={!!personal}
              feedId={desk.feed_id}
              read={personal?.read.has(s.id)}
              saved={personal?.saved.has(s.id)}
              shared={personal?.shared.has(s.id)}
              readIds={personal?.read}
              clusterExpanded={personal?.clusterExpanded}
            />
          ))}
          {briefs.length > 0 ? <BriefBlock items={briefs} /> : null}
        </div>
      ) : (
        <EmptyState title="No stories yet">
          They&rsquo;ll appear after the next refresh.
        </EmptyState>
      )}
    </section>
  );
}
