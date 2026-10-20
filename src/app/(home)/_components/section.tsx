import type { Article, Feed } from '@/lib/db';
import { assignTiers, hostOf, weight, type Tier } from '@/lib/render/tiers';
import { StoryCard } from './story-card';
import { BriefBlock } from './brief-block';

/** One feed = one desk: a section header plus the generative grid. */
export function Section({
  feed,
  articles,
}: {
  feed: Feed;
  articles: Article[];
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

  // Rank by prominence (points + image), highest first, so the lead is the
  // top-scored story; then assign tiers down that order.
  const ranked = [...articles].sort((a, b) => weight(b) - weight(a));
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
          <StoryCard key={x.a.id} article={x.a} tier={x.t} />
        ))}
        {briefs.length ? <BriefBlock items={briefs} /> : null}
      </div>
    </section>
  );
}
