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

/** A stored timestamp as a short date and time, or the text unchanged. */
function when(stored: string): string {
  const date = new Date(stored.includes('T') ? stored : `${stored}Z`);
  return Number.isNaN(date.getTime())
    ? stored
    : date.toLocaleString('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'UTC',
      }) + ' UTC';
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
  return (
    <div className="feedsummary">
      {icon ? (
        <img src={icon} alt="" width={32} height={32} />
      ) : (
        <span className="noicon" aria-hidden="true" />
      )}
      <div>
        {heading ? <h1>{name}</h1> : <strong>{name}</strong>}{' '}
        {feed.format ? (
          <span className="badge">{formatName(feed.format)}</span>
        ) : null}
        {feed.description ? <p className="desc">{feed.description}</p> : null}
        <div className="u">
          {feed.site_url ? (
            <>
              <a href={feed.site_url} target="_blank" rel="noopener noreferrer">
                {feed.site_url}
              </a>
              {' · '}
            </>
          ) : null}
          <a href={feed.url} target="_blank" rel="noopener noreferrer">
            {feed.url}
          </a>
        </div>
        <div className="u">{facts.join(' · ')}</div>
        {imageSrc && image ? (
          <figure className="feedimage">
            <img src={imageSrc} alt={image.title} />
            {image.title || image.link ? (
              <figcaption>
                {image.title}
                {image.link ? (
                  <>
                    {' · '}
                    <a
                      href={image.link}
                      target="_blank"
                      rel="noopener noreferrer"
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
          <dl className="feedfacts">
            {declared.map((f) => (
              <div key={f.label}>
                <dt>{f.label}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
    </div>
  );
}
