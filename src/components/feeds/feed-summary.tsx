import type { ReactElement } from 'react';

import { feedResource } from '@/domain/api/feed-resource';
import {
  formatName,
  headerFacts,
  headerImage,
  updateFrequency,
} from '@/domain/render/feed-details';
import { pictureSrc } from '@/domain/render/pictures';
import { hostOf } from '@/domain/render/tiers';
import type { Feed } from '@/domain/repository';
import { imageSigner } from '@/lib/cloudflare/images/server';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/components/ui/cn';
import { formatTimestamp } from '@/lib/intl';

/** A stored timestamp as a short date and time, or the text unchanged. */
function when(stored: string): string {
  const date = new Date(stored.includes('T') ? stored : `${stored}Z`);
  return Number.isNaN(date.getTime()) ? stored : `${formatTimestamp(date)} UTC`;
}

/** A feed's icon, signed for the image proxy, or a blank tile without one. */
export async function FeedIcon({
  feed,
}: {
  readonly feed: Pick<Feed, 'icon'>;
}): Promise<ReactElement> {
  const icon = feed.icon
    ? await pictureSrc(feed.icon, 64, imageSigner())
    : null;
  return icon ? (
    <img
      src={icon}
      alt=""
      width={32}
      height={32}
      className="size-8 shrink-0 rounded-control bg-ink/5"
    />
  ) : (
    <span
      className="block size-8 shrink-0 rounded-control bg-ink/10"
      aria-hidden="true"
    />
  );
}

/**
 * A feed's identity at a glance: its icon, name, format, site, description,
 * language, when it last changed, how often it says it changes and when we
 * last fetched it. `heading` makes the name the page's heading.
 */
export async function FeedSummary({
  feed,
  heading = false,
}: {
  readonly feed: Feed;
  readonly heading?: boolean;
}): Promise<ReactElement> {
  const signer = imageSigner();
  const icon = feed.icon ? await pictureSrc(feed.icon, 64, signer) : null;
  const header = feedResource(feed).metadata;
  const image = headerImage(header);
  const imageSrc = image ? await pictureSrc(image.url, 240, signer) : null;
  const declared = headerFacts(header);
  const name = feed.title || hostOf(feed.url);
  const facts = [
    feed.language ? `Language ${feed.language}` : null,
    feed.feed_updated_at ? `Updated ${when(feed.feed_updated_at)}` : null,
    feed.update_minutes
      ? `Changes ${updateFrequency(feed.update_minutes)}`
      : null,
    feed.last_fetched_at
      ? `Fetched ${when(feed.last_fetched_at)}`
      : 'Not fetched yet',
  ].filter((f): f is string => f !== null);
  const link =
    'focus-ring rounded-sm wrap-anywhere text-muted underline-offset-2 hover:text-ink hover:underline';
  return (
    <div className="flex items-start gap-4">
      {icon ? (
        <img
          src={icon}
          alt=""
          width={32}
          height={32}
          className={cn(
            'shrink-0 rounded-control bg-ink/5',
            heading ? 'size-12' : 'size-8',
          )}
        />
      ) : (
        <span
          className={cn(
            'shrink-0 rounded-control bg-ink/10',
            heading ? 'size-12' : 'size-8',
          )}
          aria-hidden="true"
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {heading ? (
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {name}
            </h1>
          ) : (
            <strong className="text-base font-semibold">{name}</strong>
          )}{' '}
          {feed.format ? <Badge>{formatName(feed.format)}</Badge> : null}
        </div>
        {feed.description ? (
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            {feed.description}
          </p>
        ) : null}
        <div className="mt-2 text-xs">
          {feed.site_url ? (
            <>
              <a
                href={feed.site_url}
                target="_blank"
                rel="noopener noreferrer"
                className={link}
              >
                {feed.site_url}
              </a>
              {' · '}
            </>
          ) : null}
          <a
            href={feed.url}
            target="_blank"
            rel="noopener noreferrer"
            className={link}
          >
            {feed.url}
          </a>
        </div>
        <div className="mt-1 text-xs text-subtle">{facts.join(' · ')}</div>
        {imageSrc && image ? (
          <figure className="mt-4">
            <img
              src={imageSrc}
              alt={image.title}
              className="max-h-24 rounded-control"
            />
            {image.title || image.link ? (
              <figcaption className="mt-1 text-xs text-subtle">
                {image.title}
                {image.link ? (
                  <>
                    {' · '}
                    <a
                      href={image.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={link}
                    >
                      {image.link}
                    </a>
                  </>
                ) : null}
              </figcaption>
            ) : null}
          </figure>
        ) : null}
        {heading && declared.length ? (
          <dl className="mt-6 grid gap-x-6 gap-y-3 rounded-card border border-line bg-surface p-5 text-sm sm:grid-cols-2">
            {declared.map((f) => (
              <div key={f.label} className="min-w-0">
                <dt className="text-xs font-medium text-subtle">{f.label}</dt>
                <dd className="mt-0.5 wrap-break-word text-ink">{f.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
    </div>
  );
}
