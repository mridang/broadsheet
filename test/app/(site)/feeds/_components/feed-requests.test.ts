import { afterEach, describe, expect, it, jest } from '@jest/globals';

import {
  followFeed,
  refreshFeeds,
  unfollowFeed,
} from '../../../../../src/app/(site)/feeds/_components/feed-requests';
import { ProblemError } from '../../../../../src/lib/problem-message';

afterEach(() => {
  jest.restoreAllMocks();
});

/** Answer the next `fetch` with `response`; returns the spy. */
function answer(response: Response) {
  return jest.spyOn(globalThis, 'fetch').mockResolvedValue(response);
}

const refusal = (detail: string) =>
  new Response(JSON.stringify({ title: 'No', detail }), {
    status: 400,
    headers: { 'Content-Type': 'application/problem+json' },
  });

describe('followFeed', () => {
  it('posts the address as JSON to the feeds collection', async () => {
    const spy = answer(new Response('{}', { status: 201 }));
    await followFeed('https://a.test/f');
    expect(spy).toHaveBeenCalledWith('/api/feeds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://a.test/f' }),
    });
  });

  it('throws the server’s own words when it refuses', async () => {
    answer(refusal('The feed is not valid.'));
    await expect(followFeed('x')).rejects.toThrow(
      new ProblemError('The feed is not valid.'),
    );
  });
});

describe('unfollowFeed', () => {
  it('deletes the feed’s own address', async () => {
    const spy = answer(new Response(null, { status: 204 }));
    await unfollowFeed(12);
    expect(spy).toHaveBeenCalledWith('/api/feeds/12', { method: 'DELETE' });
  });

  it('throws when the feed was not there', async () => {
    answer(new Response('{"detail":"No such feed."}', { status: 404 }));
    await expect(unfollowFeed(12)).rejects.toBeInstanceOf(ProblemError);
  });
});

describe('refreshFeeds', () => {
  it('posts to the feed refreshes collection', async () => {
    const spy = answer(new Response('{}', { status: 200 }));
    await refreshFeeds();
    expect(spy).toHaveBeenCalledWith('/api/feed-refreshes', {
      method: 'POST',
    });
  });

  it('throws when the server refuses', async () => {
    answer(new Response(null, { status: 401 }));
    await expect(refreshFeeds()).rejects.toBeInstanceOf(ProblemError);
  });
});
