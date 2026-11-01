import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { pinRiver, unpinRiver } from '@/app/(site)/_components/river-requests';

afterEach(() => {
  jest.restoreAllMocks();
});

const answer = (response: Response) =>
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(response);

describe('pinRiver', () => {
  it('posts the river and its place', async () => {
    const spy = answer(new Response('{}', { status: 201 }));
    await pinRiver('feed:4', 'right', 2);
    expect(spy).toHaveBeenCalledWith('/api/users/self/rivers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ river_id: 'feed:4', side: 'right', position: 2 }),
    });
  });
});

describe('unpinRiver', () => {
  it('deletes the river’s own address', async () => {
    const spy = answer(new Response(null, { status: 204 }));
    await unpinRiver(5);
    expect(spy).toHaveBeenCalledWith('/api/users/self/rivers/5', {
      method: 'DELETE',
    });
  });
});
