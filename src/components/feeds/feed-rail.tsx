import type { ReactElement } from 'react';

import { pictureSrc } from '@/domain/render/pictures';
import { hostOf } from '@/domain/render/tiers';
import { imageSigner } from '@/lib/cloudflare/images/server';

/** One feed as the rail lists it. */
export interface RailFeed {
  readonly id: number;
  readonly url: string;
  readonly title: string | null;
  readonly icon: string | null;
  readonly muted: boolean;
}

/**
 * The reader's feeds down the side of the page, like any newsreader: each one
 * opens its own page of stories. Collapsible, so on a phone it folds away
 * above the paper instead of squeezing it.
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
    <nav className="feedrail" aria-label="Your feeds">
      <details open>
        <summary>Your feeds</summary>
        <ul>
          {feeds.map((f, i) => (
            <li key={f.id}>
              <a
                className={f.id === current ? 'current' : undefined}
                aria-current={f.id === current ? 'page' : undefined}
                href={`/feeds/${f.id}`}
              >
                {icons[i] ? (
                  <img src={icons[i]} alt="" width={16} height={16} />
                ) : (
                  <span className="noicon" aria-hidden="true" />
                )}
                <span className={f.muted ? 'muted' : undefined}>
                  {f.title || hostOf(f.url)}
                </span>
              </a>
            </li>
          ))}
        </ul>
        <a className="manage" href="/feeds">
          Manage feeds
        </a>
      </details>
    </nav>
  );
}
