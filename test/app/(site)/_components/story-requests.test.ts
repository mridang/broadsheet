import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { markRead, markUnread } from '@/app/(site)/_components/story-requests';

const real = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = real;
});

function spy() {
  const fetch = jest.fn<(url: string, init: RequestInit) => Promise<Response>>(
    async () => new Response(null, { status: 204 }),
  );
  globalThis.fetch = fetch as never;
  return fetch;
}

describe('markRead', () => {
  it('posts the read, kept alive so it survives leaving the page', () => {
    const fetch = spy();
    markRead(4);
    expect(fetch).toHaveBeenCalledWith('/api/users/self/reads/4', {
      method: 'POST',
      keepalive: true,
    });
  });
});

describe('markUnread', () => {
  it('deletes the read', () => {
    const fetch = spy();
    markUnread(4);
    expect(fetch).toHaveBeenCalledWith('/api/users/self/reads/4', {
      method: 'DELETE',
    });
  });

  it('swallows a failure', async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new Error('offline');
    }) as never;
    expect(() => markUnread(4)).not.toThrow();
    await Promise.resolve();
  });
});
