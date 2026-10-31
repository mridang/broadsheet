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
 * One feed = one desk: a section header plus the generative grid, printed in
 * the order and at the tiers its layout gives. With `personal`, the reader's
 * reads and saves show on the cards.
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
  const head = (
    <div className="sechead">
      <h3>{desk.title}</h3>
      <span className="secdesc">{hostOf(desk.url)}</span>
      <span className="seccount">
        {stories.length} {stories.length === 1 ? 'item' : 'items'}
      </span>
    </div>
  );

  if (!stories.length) {
    return (
      <section className="zone">
        {head}
        <p className="secdesc empty">
          No articles yet — they&rsquo;ll appear after the next refresh.
        </p>
      </section>
    );
  }

  const main = stories.filter((s) => s.tier !== 'brief');
  const briefs = stories.filter((s) => s.tier === 'brief').map((s) => s.a);

  return (
    <section className="zone">
      {head}
      <div className="grid">
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
    </section>
  );
}
