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
    const out = html(<FeedHealth statistics={stats()} />);
    expect(out).toContain('Last fetched 2026-10-20 06:00:00 UTC');
    expect(out).toContain('1 story in the last 7 editions');
    expect(out).not.toContain('Broken');
  });

  it('flags a broken feed with its error', () => {
    const out = html(
      <FeedHealth
        statistics={stats({
          fail_count: 4,
          last_error: 'HTTP 404',
          last_fetched_at: null,
        })}
      />,
    );
    expect(out).toContain('Broken: 4 fetches failed (HTTP 404).');
    expect(out).toContain('Not fetched yet');
  });

  it('shows nothing without statistics', () => {
    expect(html(<FeedHealth statistics={undefined} />)).toBe('');
  });
});
