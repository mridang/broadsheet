import { describe, expect, it } from '@jest/globals';

import {
  FeedHealth,
  isBroken,
} from '@/app/(site)/feeds/_components/feed-health';
import { html } from '../../../../components/render';

const stats = (over = {}) => ({
  last_fetched_at: '2026-10-20 06:00:00',
  last_error: null,
  fail_count: 0,
  update_minutes: null,
  subscribers: 2,
  active_subscribers: 2,
  story_count: 1,
  stories_last_month: 1,
  stories_per_month: [],
  average_stories_per_month: 1,
  stories_per_weekday: {},
  stories_per_hour: {},
  fetch_history: [],
  stories_per_day: [{ date: '2026-10-20', count: 1 }],
  ...over,
});

describe('isBroken', () => {
  it('flags three failures in a row', () => {
    expect(isBroken({ fail_count: 2 })).toBe(false);
    expect(isBroken({ fail_count: 3 })).toBe(true);
  });
});

describe('FeedHealth', () => {
  it('shows the last fetch and recent stories', () => {
    const out = html(<FeedHealth id={4} statistics={stats()} />);
    expect(out).toContain('Last fetched 2026-10-20 06:00:00 UTC');
    expect(out).toContain('1 story in the last 7 editions');
    expect(out).not.toContain('Broken');
    expect(out).not.toContain('Retry now');
    expect(out).toContain('1 a month');
    expect(out).toContain('2 readers');
  });

  it('flags a broken feed with its error', () => {
    const out = html(
      <FeedHealth
        id={4}
        statistics={stats({
          fail_count: 4,
          last_error: 'HTTP 404',
          last_fetched_at: null,
        })}
      />,
    );
    expect(out).toContain('Broken: 4 fetches failed (HTTP 404).');
    expect(out).toContain('Not fetched yet');
    expect(out).toContain('Retry now');
  });

  it('shows nothing without statistics', () => {
    expect(html(<FeedHealth id={4} statistics={undefined} />)).toBe('');
  });
});
