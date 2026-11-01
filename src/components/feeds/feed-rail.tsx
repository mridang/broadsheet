import type { ReactElement } from 'react';

import { SidebarLink } from '@/components/site/sidebar-link';
import { pictureSrc } from '@/domain/render/pictures';
import { hostOf } from '@/domain/render/tiers';
import { imageSigner } from '@/lib/cloudflare/images/server';
import { cn } from '@/components/ui/cn';

/** One feed as the rail lists it. */
export interface RailFeed {
  readonly id: number;
  readonly url: string;
  readonly title: string | null;
  readonly icon: string | null;
  readonly muted: boolean;
  /** How many stories it has kept, when known. */
  readonly count?: number;
}

/**
 * The reader's feeds down the side of the page, like any newsreader: each one
 * opens its own page of stories, with its icon and how many stories it holds.
 * Collapsible, so it can be folded away.
 */
export async function FeedRail({
  feeds,
  current,
}: {
  readonly feeds: readonly RailFeed[];
  readonly current?: number;
}): Promise<ReactElement> {
  const signer = imageSigner();
  const icons = await Promise.all(
    feeds.map((f) => (f.icon ? pictureSrc(f.icon, 32, signer) : null)),
  );
  return (
    <nav aria-label="Your feeds">
      <details open className="group">
        <summary className="focus-ring flex h-8 list-none items-center justify-between rounded-control px-3 text-xs font-semibold tracking-wide text-subtle uppercase hover:text-ink [&::-webkit-details-marker]:hidden">
          Your feeds
          <span
            aria-hidden="true"
            className="text-[0.6rem] transition-transform group-open:rotate-90"
          >
            ▶
          </span>
        </summary>
        <ul className="mt-1 space-y-0.5">
          {feeds.map((f, i) => (
            <li key={f.id}>
              <SidebarLink
                href={`/feeds/${f.id}`}
                current={current === undefined ? undefined : f.id === current}
              >
                {icons[i] ? (
                  <img
                    src={icons[i]}
                    alt=""
                    width={16}
                    height={16}
                    className="size-4 shrink-0 rounded-sm"
                  />
                ) : (
                  <span
                    className="size-4 shrink-0 rounded-sm bg-ink/10"
                    aria-hidden="true"
                  />
                )}
                <span
                  className={cn('flex-1 truncate', f.muted && 'opacity-60')}
                >
                  {f.title || hostOf(f.url)}
                </span>
                {f.count ? (
                  <span className="text-xs text-subtle tabular-nums">
                    {f.count}
                  </span>
                ) : null}
              </SidebarLink>
            </li>
          ))}
        </ul>
        <a
          className="focus-ring mt-2 inline-flex h-8 items-center rounded-control px-3 text-xs font-medium text-subtle hover:text-ink"
          href="/feeds"
        >
          Manage feeds
        </a>
      </details>
    </nav>
  );
}
