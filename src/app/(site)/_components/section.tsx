import type { Article, Feed } from '@/domain/repository';
import {
  assignTiers,
  hostOf,
  rank,
  type Tier,
  type Training,
} from '@/domain/render/tiers';
import { StoryCard } from '@/app/(site)/_components/story-card';
import { BriefBlock } from '@/app/(site)/_components/brief-block';

/** What the reader has done, which shapes their desks. */
export interface Personal {
  readonly training: readonly Training[];
  readonly read: ReadonlySet<number>;
  readonly saved: ReadonlySet<number>;
}

/**
 * One feed = one desk: a section header plus the generative grid. With
 * `personal`, the reader's training orders the desk and their reads and saves
 * show on the cards.
 */
export function Section({
  feed,
  articles,
  personal,
}: {
  feed: Feed;
  articles: Article[];
  personal?: Personal;
}) {
  const head = (
    <div className="sechead">
      <h3>{feed.title || hostOf(feed.url)}</h3>
      <span className="secdesc">{hostOf(feed.url)}</span>
      <span className="seccount">
        {articles.length} {articles.length === 1 ? 'item' : 'items'}
      </span>
    </div>
  );

  if (!articles.length) {
    return (
      <section className="zone">
        {head}
        <p className="secdesc empty">
          No articles yet — they&rsquo;ll appear after the next refresh.
        </p>
      </section>
    );
  }

  // Rank liked stories first, then by prominence (points + image), so the lead
  // is the top story; disliked ones leave. Then assign tiers down that order.
  const ranked = rank(articles, personal?.training);
  const tiers = assignTiers(ranked);
  const tierOf = (i: number): Tier => tiers[i] ?? 'standard';
  const main = ranked
    .map((a, i) => ({ a, t: tierOf(i) }))
    .filter((x) => x.t !== 'brief');
  const briefs = ranked.filter((_, i) => tierOf(i) === 'brief');

  return (
    <section className="zone">
      {head}
      <div className="grid">
        {main.map((x) => (
          <StoryCard
            key={x.a.id}
            article={x.a}
            tier={x.t}
            personal={!!personal}
            read={personal?.read.has(x.a.id)}
            saved={personal?.saved.has(x.a.id)}
          />
        ))}
        {briefs.length ? <BriefBlock items={briefs} /> : null}
      </div>
    </section>
  );
}
