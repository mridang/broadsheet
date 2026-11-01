import type { ReactElement, ReactNode } from 'react';

import { pictureSrc } from '@/domain/render/pictures';
import { imageSigner } from '@/lib/cloudflare/images/server';

/** A story as a list row shows it. */
export interface RowStory {
  /** Where the title goes: the story's own page, or the original. */
  readonly href: string;
  readonly title: string;
  /** Opens `href` in a new tab, for a link to another site. */
  readonly external?: boolean;
  /** Small words above the title: the source and the date. */
  readonly meta: readonly (string | null | undefined)[];
  readonly excerpt?: string | null;
  /** The story's picture, shown through the image proxy when it can be. */
  readonly image?: string | null;
}

/**
 * One story in a reading list: where it is from and when, its title, the start
 * of its text and its picture on the right, with `children` (its links and
 * actions) beneath. Render it inside a `<ul>` or `<ol>` of `divide-y`.
 */
export async function StoryRow({
  story,
  children,
}: Readonly<{ story: RowStory; children?: ReactNode }>): Promise<ReactElement> {
  const thumb = story.image
    ? await pictureSrc(story.image, 288, imageSigner())
    : null;
  const meta = story.meta.filter(Boolean).join(' · ');
  return (
    <li className="group flex gap-4 py-5 sm:gap-6">
      <div className="min-w-0 flex-1">
        {meta ? (
          <p className="truncate text-xs font-medium text-subtle">{meta}</p>
        ) : null}
        <a
          href={story.href}
          className="focus-ring mt-1 block rounded-sm text-base leading-snug font-semibold text-ink hover:text-accent sm:text-lg"
          {...(story.external
            ? { target: '_blank', rel: 'noopener noreferrer' }
            : {})}
        >
          {story.title}
        </a>
        {story.excerpt ? (
          <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted">
            {story.excerpt}
          </p>
        ) : null}
        {children ? (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-subtle">
            {children}
          </div>
        ) : null}
      </div>
      {thumb ? (
        <img
          src={thumb}
          alt=""
          loading="lazy"
          className="h-16 w-24 shrink-0 rounded-card bg-ink/5 object-cover sm:h-24 sm:w-36"
        />
      ) : null}
    </li>
  );
}

/** A quiet text link under a story row, such as "Original". */
export const ROW_LINK =
  'focus-ring inline-flex h-8 items-center gap-1.5 rounded-control px-2 -mx-2 text-sm font-medium text-muted transition-colors hover:bg-ink/5 hover:text-ink active:bg-ink/10';
