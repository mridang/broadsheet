import type { Article } from '@/lib/db';
import { TIER, ago, excerpt, hostOf, type Tier } from '@/lib/render/tiers';

/**
 * One story. Tier fixes the lane span and excerpt budget; lead/feature
 * photos float (alternating side by id) so the body copy wraps around them.
 */
export function StoryCard({ article, tier }: { article: Article; tier: Tier }) {
  const [span, budget] = TIER[tier];
  const side = article.id % 2 ? 'ph-l' : 'ph-r';
  const ex = budget ? excerpt(article.summary, budget) : '';
  const cls = `card t-${tier} w${span}${article.image ? '' : ' noimg'}`;

  return (
    <article className={cls}>
      <a
        className="hit"
        href={article.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={article.title ?? ''}
      />
      <div className="meat">
        <div className="kicker">
          <span className="num">•</span>
          {article.favicon ? (
            <img className="fav" loading="lazy" src={article.favicon} alt="" />
          ) : null}{' '}
          {article.source || hostOf(article.url)}
          <span className="score">{ago(article.published_at)}</span>
        </div>
        <h2 className="hl">{article.title}</h2>
        {article.image ? (
          <figure className={`ph ${side}`}>
            <img loading="lazy" src={article.image} alt="" />
          </figure>
        ) : null}
        {ex ? <p className="ex">{ex}</p> : null}
        <span className="more">Read full story ↗</span>
      </div>
    </article>
  );
}
