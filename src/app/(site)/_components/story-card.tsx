import type { Article } from '@/domain/repository';
import { pictureSrc } from '@/domain/render/pictures';
import {
  SaveButton,
  StoryActions,
} from '@/app/(site)/_components/story-actions';
import { Icon } from '@/components/ui/icons';
import {
  MENU_ITEM,
  MENU_TRIGGER,
  Menu,
  MenuDivider,
} from '@/components/ui/menu';
import { ListenButton } from '@/app/(site)/_components/listen-button';
import { ShareButton } from '@/app/(site)/_components/share-button';
import { StoryChanges } from '@/app/(site)/_components/story-changes';
import {
  ClusterBadge,
  ClusterPreview,
  clusterPictures,
} from '@/app/(site)/_components/cluster-preview';
import type { Sibling } from '@/domain/render/layout';
import { hasChanges } from '@/domain/render/changes';
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
    card: 'flex flex-col rounded-card border border-line bg-surface transition-shadow has-[[data-story-link]:hover]:shadow-raised',
    photo: 'aspect-video w-full rounded-t-card',
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
  'focus-ring pointer-events-auto relative z-10 rounded-control font-medium text-subtle transition-colors hover:text-ink';

/**
 * How a read story is dimmed: its words and photo fade, never the card, so its
 * menu stays opaque and above the stories after it.
 */
const DIM = 'transition-opacity group-data-read:opacity-55';

/**
 * One story. Its tier decides how much room it gets (a lead spans the desk
 * with a large photo, a feature is a card, a standard story a row) and how
 * long its excerpt is. The whole card is a link to the story; its controls sit
 * above that link. A story the person has read is dimmed (its words, not its controls); a signed-in person
 * (`personal`) gets the training and save controls (`feedId` lets them train
 * the feed, and share the story). `also` names the other sources that
 * covered the same story; with their `siblings` (its cluster) it gets a badge
 * and a preview of each copy, `clusterExpanded` with pictures and openings,
 * and `readIds` dims the copies read. A story whose text changed since it was
 * first seen can show what changed.
 */
export async function StoryCard({
  article,
  tier,
  also = [],
  siblings = [],
  read = false,
  saved = false,
  shared = false,
  readIds,
  clusterExpanded = false,
  personal = false,
  feedId,
}: {
  article: Article;
  tier: Exclude<Tier, 'brief'>;
  also?: readonly string[];
  siblings?: readonly Sibling[];
  read?: boolean;
  saved?: boolean;
  shared?: boolean;
  readIds?: ReadonlySet<number>;
  clusterExpanded?: boolean;
  personal?: boolean;
  feedId?: number;
}) {
  const [, budget] = TIER[tier];
  const ex = budget ? excerpt(article.summary, budget) : '';
  const signer = imageSigner();
  const photo = await pictureSrc(article.image ?? '', IMG_WIDTH[tier], signer);
  const icon = await pictureSrc(article.favicon ?? '', FAVICON_WIDTH, signer);
  const previews = await clusterPictures(siblings, clusterExpanded);
  const look = LOOK[tier];
  const source = article.source || hostOf(article.url);

  return (
    <article
      className={cn(
        'group relative min-w-0',
        'print:break-inside-avoid print:after:block print:after:text-label print:after:wrap-anywhere print:after:text-ink/70 print:after:content-[attr(data-url)]',
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
          className={cn(
            'pointer-events-none bg-ink/5 object-cover',
            DIM,
            look.photo,
          )}
        />
      ) : null}
      <div
        className={cn(
          'pointer-events-none min-w-0 flex-1',
          tier === 'feature' && 'p-4',
        )}
      >
        <p
          className={cn(
            'flex items-center gap-2 text-xs font-medium text-subtle',
            DIM,
          )}
        >
          {icon ? (
            <img
              className="size-4 rounded-control"
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
          {siblings.length ? <ClusterBadge siblings={siblings} /> : null}
        </p>
        <h2
          className={cn(
            'mt-2 font-semibold tracking-tight text-balance text-ink group-has-[[data-story-link]:hover]:text-accent',
            DIM,
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
              DIM,
              tier === 'standard' ? 'line-clamp-2' : 'line-clamp-4',
              tier === 'lead' && 'sm:text-base',
            )}
          >
            {ex}
          </p>
        ) : null}
        {siblings.length ? (
          <ClusterPreview
            siblings={siblings}
            expanded={clusterExpanded}
            pictures={previews}
            {...(readIds ? { read: readIds } : {})}
          />
        ) : also.length ? (
          <p data-part="" className={cn('mt-2 text-xs text-subtle', DIM)}>
            Also covered by: {also.join(', ')}
          </p>
        ) : null}
        {hasChanges(article.original_summary, article.summary) ? (
          <StoryChanges
            original={article.original_summary!}
            current={article.summary ?? ''}
          />
        ) : null}
        <div className="mt-3 flex items-center gap-1">
          <span className="mr-auto text-xs font-medium text-subtle print:hidden">
            Read full story ↗
          </span>
          {personal ? (
            <SaveButton
              articleId={article.id}
              saved={saved}
              title={article.title ?? ''}
            />
          ) : null}
          <Menu
            label="More actions"
            className="pointer-events-auto relative z-10 print:hidden"
            triggerClassName={MENU_TRIGGER}
            trigger={<Icon name="more" />}
            width="w-72"
          >
            <StoryMenuItems
              article={article}
              excerpt={ex}
              source={source}
              personal={personal}
              shared={shared}
              feedId={feedId}
            />
          </Menu>
        </div>
      </div>
    </article>
  );
}

/**
 * What a story's "More actions" menu holds: its full text when it was kept,
 * Listen, and for a signed-in person Share and the training controls.
 */
export function StoryMenuItems({
  article,
  excerpt,
  source,
  personal,
  shared,
  feedId,
}: Readonly<{
  article: Article;
  excerpt: string;
  source: string;
  personal: boolean;
  shared: boolean;
  feedId?: number | undefined;
}>) {
  const ex = excerpt;
  return (
    <>
      {article.body_text ? (
        <a
          className={MENU_ITEM}
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
        className={MENU_ITEM}
      />
      {personal ? (
        <ShareButton
          articleId={article.id}
          shared={shared}
          title={article.title ?? ''}
          inline
          summaryClassName={MENU_ITEM}
        />
      ) : null}
      {personal ? (
        <>
          <MenuDivider />
          <StoryActions
            source={source}
            feedId={feedId}
            author={article.author}
            tags={tagsOf(article.tags)}
            title={article.title ?? ''}
          />
        </>
      ) : null}
    </>
  );
}
