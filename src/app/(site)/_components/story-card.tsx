import type { Article } from '@/domain/repository';
import { pictureSrc } from '@/domain/render/pictures';
import { StoryActions } from '@/app/(site)/_components/story-actions';
import { ListenButton } from '@/app/(site)/_components/listen-button';
import { spokenText } from '@/app/(site)/_components/read-aloud';
import { imageSigner } from '@/lib/cloudflare/images/server';
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
 * A story the person has read is dimmed; a signed-in person (`personal`) gets
 * the training and save controls. `also` names the other sources that covered
 * the same story.
 */
export async function StoryCard({
  article,
  tier,
  also = [],
  read = false,
  saved = false,
  personal = false,
}: {
  article: Article;
  tier: Tier;
  also?: readonly string[];
  read?: boolean;
  saved?: boolean;
  personal?: boolean;
}) {
  const [span, budget] = TIER[tier];
  const side = article.id % 2 ? 'ph-l' : 'ph-r';
  const ex = budget ? excerpt(article.summary, budget) : '';
  const signer = imageSigner();
  const photo = await pictureSrc(article.image ?? '', IMG_WIDTH[tier], signer);
  const icon = await pictureSrc(article.favicon ?? '', FAVICON_WIDTH, signer);
  const cls = `card t-${tier} w${span}${photo ? '' : ' noimg'}${read ? ' read' : ''}`;

  return (
    <article
      className={cls}
      data-url={article.url}
      data-article-id={personal ? article.id : undefined}
    >
      <a
        className="hit focus-ring-flush"
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
        {also.length ? (
          <p className="also">Also covered by: {also.join(', ')}</p>
        ) : null}
        <div className="storyfoot">
          <span className="more">Read full story ↗</span>
          {article.body_text ? (
            <a
              className="more textlink focus-ring"
              data-action="full-text"
              href={`/article/${article.id}`}
            >
              Full text
            </a>
          ) : null}
          <ListenButton
            title={article.title ?? ''}
            text={spokenText(article.title ?? '', ex)}
          />
          {personal ? (
            <StoryActions
              articleId={article.id}
              source={article.source || hostOf(article.url)}
              saved={saved}
            />
          ) : null}
        </div>
      </div>
    </article>
  );
}
