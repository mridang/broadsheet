import { afterEach, describe, expect, it, jest } from '@jest/globals';

import {
  removeSearch,
  saveSearch,
} from '@/app/(site)/search/_components/search-requests';
import { ProblemError } from '@/components/api/problem-message';

afterEach(() => {
  jest.restoreAllMocks();
});

const answer = (response: Response) =>
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(response);

describe('saveSearch', () => {
  it('posts the words, and the feed when there is one', async () => {
    const spy = answer(new Response('{}', { status: 201 }));
    await saveSearch('rust');
    await saveSearch('go', '4');
    expect(spy.mock.calls.map((c) => c[1]?.body)).toEqual([
      JSON.stringify({ query: 'rust' }),
      JSON.stringify({ query: 'go', feed_id: '4' }),
    ]);
    expect(spy.mock.calls[0]?.[0]).toBe('/api/users/self/searches');
  });

  it('throws the server’s own words when it refuses', async () => {
    answer(
      Response.json(
        { title: 'No', detail: 'Not valid.' },
        {
          status: 400,
          headers: { 'Content-Type': 'application/problem+json' },
        },
      ),
    );
    await expect(saveSearch('x')).rejects.toThrow(
      new ProblemError('Not valid.'),
    );
  });
});

describe('removeSearch', () => {
  it('deletes the search’s own address', async () => {
    const spy = answer(new Response(null, { status: 204 }));
    await removeSearch(3);
    expect(spy).toHaveBeenCalledWith('/api/users/self/searches/3', {
      method: 'DELETE',
    });
  });
});
