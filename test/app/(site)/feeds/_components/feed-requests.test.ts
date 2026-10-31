import { afterEach, describe, expect, it, jest } from '@jest/globals';

import {
  addSection,
  editFeed,
  fetchOpml,
  importTopics,
  followFeed,
  removeSection,
  refreshFeeds,
  unfollowFeed,
} from '@/app/(site)/feeds/_components/feed-requests';
import { ProblemError } from '@/components/api/problem-message';

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
  it('posts to the feed refreshes', async () => {
    const spy = answer(new Response('{}', { status: 200 }));
    await refreshFeeds();
    expect(spy).toHaveBeenCalledWith('/api/feeds/refreshes', {
      method: 'POST',
    });
  });

  it('throws when the server refuses', async () => {
    answer(new Response(null, { status: 401 }));
    await expect(refreshFeeds()).rejects.toBeInstanceOf(ProblemError);
  });
});

describe('editFeed', () => {
  it('patches the feed’s own address with the change as JSON', async () => {
    const spy = answer(new Response('{}', { status: 200 }));
    await editFeed(12, { muted: true, section_id: null });
    expect(spy).toHaveBeenCalledWith('/api/feeds/12', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ muted: true, section_id: null }),
    });
  });

  it('throws the server’s own words when it refuses', async () => {
    answer(refusal('The change is not valid.'));
    await expect(editFeed(12, {})).rejects.toThrow(
      new ProblemError('The change is not valid.'),
    );
  });
});

describe('addSection', () => {
  it('posts the name as JSON to the sections collection', async () => {
    const spy = answer(new Response('{}', { status: 201 }));
    await addSection('Tech');
    expect(spy).toHaveBeenCalledWith('/api/sections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Tech' }),
    });
  });

  it('throws when the server refuses', async () => {
    answer(refusal('The section is not valid.'));
    await expect(addSection('')).rejects.toBeInstanceOf(ProblemError);
  });
});

describe('removeSection', () => {
  it('deletes the section’s own address', async () => {
    const spy = answer(new Response(null, { status: 204 }));
    await removeSection(4);
    expect(spy).toHaveBeenCalledWith('/api/sections/4', { method: 'DELETE' });
  });

  it('throws when the section was not there', async () => {
    answer(new Response('{"detail":"No such section."}', { status: 404 }));
    await expect(removeSection(4)).rejects.toBeInstanceOf(ProblemError);
  });
});

describe('importTopics', () => {
  it('posts the topic ids as JSON to the imports', async () => {
    const spy = answer(new Response('{}', { status: 201 }));
    await importTopics(['design']);
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe('/api/feeds/imports');
    expect(init).toMatchObject({
      method: 'POST',
      body: '{"topic_ids":["design"]}',
    });
  });

  it('throws the server’s words when refused', async () => {
    answer(refusal('No such topic.'));
    await expect(importTopics(['x'])).rejects.toBeInstanceOf(ProblemError);
  });
});

describe('fetchOpml', () => {
  it('asks the feeds collection for OPML', async () => {
    const spy = answer(new Response('<opml/>'));
    expect(await (await fetchOpml()).text()).toBe('<opml/>');
    expect(spy.mock.calls[0]).toEqual([
      '/api/feeds',
      { headers: { Accept: 'text/x-opml' } },
    ]);
  });

  it('throws when refused', async () => {
    answer(refusal('No.'));
    await expect(fetchOpml()).rejects.toBeInstanceOf(ProblemError);
  });
});
