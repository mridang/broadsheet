import type { ReactElement } from 'react';

import { formatName, updateFrequency } from '@/domain/render/feed-details';
import type { Feed } from '@/domain/repository';
import { relativeTime, storedDate } from '@/lib/intl';
import { Badge } from '@/components/ui/badge';
import { Icon, type IconName } from '@/components/ui/icons';

/** The icon drawn beside each feed format's name. */
const FORMAT_ICONS: Readonly<Record<string, IconName>> = {
  rss: 'rss',
  atom: 'atom',
  rdf: 'rdf',
};

/** A feed's format as a small badge with its icon: RSS, Atom or RSS 1.0. */
export function FeedFormatBadge({
  format,
}: Readonly<{ format: string }>): ReactElement {
  return (
    <Badge tone="outline">
      <Icon name={FORMAT_ICONS[format] ?? 'rss'} className="size-3.5" />
      {formatName(format)}
    </Badge>
  );
}

/** "updated 3 hours ago", the exact moment in its `title` and `dateTime`. */
function Moment({
  label,
  stored,
  now,
}: Readonly<{ label: string; stored: string; now: Date }>): ReactElement {
  const date = storedDate(stored);
  if (!date) return <span>{`${label} ${stored}`}</span>;
  return (
    <span>
      {label}{' '}
      <time dateTime={date.toISOString()} title={date.toUTCString()}>
        {relativeTime(date, now)}
      </time>
    </span>
  );
}

/**
 * What a row of the feed manager says about a feed besides its name: its
 * format, how often it says it changes, when it last changed and when it was
 * last fetched.
 */
export function FeedRowFacts({
  feed,
  now = new Date(),
}: Readonly<{
  feed: Pick<
    Feed,
    'format' | 'update_minutes' | 'feed_updated_at' | 'last_fetched_at'
  >;
  now?: Date;
}>): ReactElement {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {feed.format ? <FeedFormatBadge format={feed.format} /> : null}
      {feed.update_minutes ? (
        <span>Changes {updateFrequency(feed.update_minutes)}</span>
      ) : null}
      {feed.feed_updated_at ? (
        <Moment label="Updated" stored={feed.feed_updated_at} now={now} />
      ) : null}
      {feed.last_fetched_at ? (
        <Moment label="Fetched" stored={feed.last_fetched_at} now={now} />
      ) : (
        <span>Not fetched yet</span>
      )}
    </span>
  );
}
