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
  tagsOf,
  type Tier,
} from '@/domain/render/tiers';
import { cn } from '@/components/ui/cn';

/** The width a source's favicon is asked for, in pixels (Google's service sends 64). */
const FAVICON_WIDTH = 64;

/** How each tier is laid out in its desk's two-column grid. */
const LOOK: Record<
  Exclude<Tier, 'brief'>,
  { card: string; photo: string; title: string }
> = {
  lead: {
    card: 'flex flex-col gap-5 pb-8 sm:col-span-2 md:flex-row-reverse md:items-start',
    photo: 'aspect-[16/10] w-full rounded-card md:w-1/2',
    title: 'text-2xl leading-tight sm:text-3xl',
  },
  feature: {
    card: 'flex flex-col overflow-hidden rounded-card border border-line bg-surface',
    photo: 'aspect-video w-full',
    title: 'text-lg leading-snug',
  },
  standard: {
    card: 'flex flex-row-reverse items-start gap-4 border-t border-line py-5 sm:col-span-2',
    photo: 'h-20 w-28 shrink-0 rounded-control sm:h-24 sm:w-36',
    title: 'text-base leading-snug sm:text-lg',
  },
};

/** A small control or link at the foot of a story, above the link that covers it. */
export const FOOT_LINK =
  'focus-ring pointer-events-auto relative z-10 rounded-sm font-medium text-subtle hover:text-ink';

/**
 * One story. Its tier decides how much room it gets (a lead spans the desk
 * with a large photo, a feature is a card, a standard story a row) and how
 * long its excerpt is. The whole card is a link to the story; its controls sit
 * above that link. A story the person has read is dimmed; a signed-in person
 * (`personal`) gets the training and save controls (`feedId` lets them train
 * the feed). `also` names the other
 * sources that covered the same story.
 */
export async function StoryCard({
  article,
  tier,
  also = [],
  read = false,
  saved = false,
  personal = false,
  feedId,
}: {
  article: Article;
  tier: Exclude<Tier, 'brief'>;
  also?: readonly string[];
  read?: boolean;
  saved?: boolean;
  personal?: boolean;
  feedId?: number;
}) {
  const [, budget] = TIER[tier];
  const ex = budget ? excerpt(article.summary, budget) : '';
  const signer = imageSigner();
  const photo = await pictureSrc(article.image ?? '', IMG_WIDTH[tier], signer);
  const icon = await pictureSrc(article.favicon ?? '', FAVICON_WIDTH, signer);
  const look = LOOK[tier];
  const source = article.source || hostOf(article.url);

  return (
    <article
      className={cn(
        'group relative transition-opacity data-read:opacity-55',
        'print:break-inside-avoid print:after:block print:after:text-[9px] print:after:wrap-anywhere print:after:text-ink/70 print:after:content-[attr(data-url)]',
        look.card,
      )}
      data-story=""
      data-url={article.url}
      data-article-id={personal ? article.id : undefined}
      data-comments-url={article.comments_url ?? undefined}
      data-read={read ? '' : undefined}
    >
      <a
        className="focus-ring-flush absolute inset-0 rounded-card"
        data-story-link=""
        href={article.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={article.title ?? ''}
      />
      {photo ? (
        <img
          data-part=""
          loading="lazy"
          src={photo}
          alt=""
          className={cn('bg-ink/5 object-cover', look.photo)}
        />
      ) : null}
      <div
        className={cn(
          'pointer-events-none min-w-0 flex-1',
          tier === 'feature' && 'p-4',
        )}
      >
        <p className="flex items-center gap-2 text-xs font-medium text-subtle">
          {icon ? (
            <img
              className="size-4 rounded-sm"
              loading="lazy"
              src={icon}
              alt=""
            />
          ) : null}
          <span className="truncate">{source}</span>
          <span aria-hidden="true">·</span>
          <span className="shrink-0">
            {article.points ? `▲ ${article.points}` : ago(article.published_at)}
          </span>
        </p>
        <h2
          className={cn(
            'mt-2 font-semibold tracking-tight text-balance text-ink group-hover:text-accent',
            look.title,
          )}
        >
          {article.title}
        </h2>
        {ex ? (
          <p
            data-part=""
            className={cn(
              'mt-2 text-sm leading-relaxed text-muted print:line-clamp-none',
              tier === 'standard' ? 'line-clamp-2' : 'line-clamp-4',
              tier === 'lead' && 'sm:text-base',
            )}
          >
            {ex}
          </p>
        ) : null}
        {also.length ? (
          <p data-part="" className="mt-2 text-xs text-subtle">
            Also covered by: {also.join(', ')}
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <span className="text-subtle print:hidden">Read full story ↗</span>
          {article.body_text ? (
            <a
              className={FOOT_LINK}
              data-action="full-text"
              href={`/article/${article.id}`}
            >
              Full text
            </a>
          ) : null}
          <ListenButton
            articleId={article.id}
            title={article.title ?? ''}
            text={spokenText(article.title ?? '', ex)}
          />
          {personal ? (
            <StoryActions
              articleId={article.id}
              source={source}
              saved={saved}
              feedId={feedId}
              author={article.author}
              tags={tagsOf(article.tags)}
            />
          ) : null}
        </div>
      </div>
    </article>
  );
}
