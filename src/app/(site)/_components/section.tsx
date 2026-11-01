import type { Article } from '@/domain/repository';
import type { LaidDesk } from '@/domain/render/layout';
import { hostOf, type Training } from '@/domain/render/tiers';
import { StoryCard } from '@/app/(site)/_components/story-card';
import { BriefBlock } from '@/app/(site)/_components/brief-block';

/** What the reader has done, which shapes their desks. */
export interface Personal {
  readonly training: readonly Training[];
  readonly read: ReadonlySet<number>;
  readonly saved: ReadonlySet<number>;
}

/**
 * One feed = one desk: its heading, then its stories in the order and at the
 * tiers its layout gives, and the low-weight tail as "In brief". With
 * `personal`, the reader's reads and saves show on the cards.
 */
export function Section({
  desk,
  articles,
  personal,
}: {
  desk: LaidDesk;
  articles: ReadonlyMap<number, Article>;
  personal?: Personal;
}) {
  const stories = desk.stories.flatMap((s) => {
    const a = articles.get(s.id);
    return a ? [{ ...s, a }] : [];
  });
  const main = stories.flatMap((s) =>
    s.tier === 'brief' ? [] : [{ ...s, tier: s.tier }],
  );
  const briefs = stories.filter((s) => s.tier === 'brief').map((s) => s.a);

  return (
    <section data-desk="" className="mt-12 first:mt-0">
      <div className="mb-5 flex items-baseline gap-3 border-b border-line pb-3">
        <h3 className="text-lg font-semibold tracking-tight text-ink">
          {desk.title}
        </h3>
        <span className="hidden truncate text-sm text-subtle sm:inline">
          {hostOf(desk.url)}
        </span>
        <span className="ml-auto shrink-0 text-xs text-subtle tabular-nums">
          {stories.length} {stories.length === 1 ? 'item' : 'items'}
        </span>
      </div>
      {stories.length ? (
        <div className="grid gap-6 sm:grid-cols-2">
          {main.map((s) => (
            <StoryCard
              key={s.id}
              article={s.a}
              tier={s.tier}
              also={s.also}
              personal={!!personal}
              read={personal?.read.has(s.id)}
              saved={personal?.saved.has(s.id)}
            />
          ))}
          {briefs.length ? <BriefBlock items={briefs} /> : null}
        </div>
      ) : (
        <p className="text-sm text-muted">
          No articles yet — they&rsquo;ll appear after the next refresh.
        </p>
      )}
    </section>
  );
}
