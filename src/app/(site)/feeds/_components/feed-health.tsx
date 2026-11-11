import type { ReactElement } from 'react';

import { RetryFeedButton } from '@/app/(site)/feeds/_components/retry-feed-button';
import type { ClassifierCounts } from '@/domain/classifier-counts';
import type { FeedStatistics } from '@/domain/repository';
import { countOf, formatTimestamp, storedDate } from '@/lib/intl';

/** Failures in a row from which a feed counts as broken. */
export const BROKEN_AFTER = 3;

/** Whether a feed has failed enough fetches in a row to be flagged. */
export function isBroken(
  statistics: Pick<FeedStatistics, 'fail_count'>,
): boolean {
  return statistics.fail_count >= BROKEN_AFTER;
}

/** A feed's last fetch and recent output, flagged when it keeps failing. */
export function FeedHealth({
  id,
  statistics,
  counts,
}: {
  readonly id: number;
  readonly statistics: FeedStatistics | undefined;
  /** The feed's unread stories by verdict, when counted. */
  readonly counts?: ClassifierCounts | undefined;
}): ReactElement | null {
  if (!statistics) return null;
  const fetched = statistics.last_fetched_at
    ? storedDate(statistics.last_fetched_at)
    : undefined;
  const stories = statistics.stories_per_day.reduce((n, d) => n + d.count, 0);
  return (
    <div className="text-xs text-subtle">
      {isBroken(statistics) ? (
        <strong role="alert" className="mb-2 block font-semibold text-danger">
          Broken: {statistics.fail_count} fetches failed
          {statistics.last_error ? ` (${statistics.last_error})` : ''}.{' '}
          <RetryFeedButton id={id} />{' '}
        </strong>
      ) : null}
      {fetched
        ? `Last fetched ${formatTimestamp(fetched)} UTC`
        : 'Not fetched yet'}
      {` · ${countOf(stories, 'story', 'stories')} in the last 7 editions`}
      {` · ${statistics.average_stories_per_month} a month`}
      {` · ${countOf(statistics.subscribers, 'reader')}`}
      {statistics.update_minutes === null
        ? ''
        : ` · asks for ${countOf(statistics.update_minutes, 'minute')} between fetches`}
      {counts
        ? ` · unread ${counts.focus} focus, ${counts.neutral} neutral, ${counts.hidden} hidden`
        : ''}
    </div>
  );
}
