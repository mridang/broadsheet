import type { Article } from '@/domain/repository';
import { pictureSrc } from '@/domain/render/pictures';
import {
  IMG_WIDTH,
  TIER,
  ago,
  excerpt,
  hostOf,
  type Tier,
} from '@/domain/render/tiers';

/** The width a source's favicon is asked for, in pixels (Google's service sends 64). */
const FAVICON_WIDTH = 64;

/**
 * One story. Tier fixes the lane span and excerpt budget; lead/feature
 * photos float (alternating side by id) so the body copy wraps around them.
 */
export function StoryCard({ article, tier }: { article: Article; tier: Tier }) {
  const [span, budget] = TIER[tier];
  const side = article.id % 2 ? 'ph-l' : 'ph-r';
  const ex = budget ? excerpt(article.summary, budget) : '';
  const photo = pictureSrc(article.image ?? '', IMG_WIDTH[tier]);
  const icon = pictureSrc(article.favicon ?? '', FAVICON_WIDTH);
  const cls = `card t-${tier} w${span}${photo ? '' : ' noimg'}`;

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
          {icon ? (
            <img className="fav" loading="lazy" src={icon} alt="" />
          ) : null}{' '}
          {article.source || hostOf(article.url)}
          <span className="score">
            {article.points ? `▲ ${article.points}` : ago(article.published_at)}
          </span>
        </div>
        <h2 className="hl">{article.title}</h2>
        {photo ? (
          <figure className={`ph ${side}`}>
            <img loading="lazy" src={photo} alt="" />
          </figure>
        ) : null}
        {ex ? <p className="ex">{ex}</p> : null}
        <span className="more">Read full story ↗</span>
      </div>
    </article>
  );
}
