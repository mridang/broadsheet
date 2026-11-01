import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { setNotification } from '@/app/(site)/settings/_components/settings-requests';

/** Stand in for fetch, answering every call with `status`. */
function answering(status: number) {
  const calls: { input: string; init?: RequestInit }[] = [];
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    calls.push({ input: String(input), init });
    return new Response(null, { status });
  });
  return calls;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('setNotification', () => {
  it('puts the setting when a channel is ticked', async () => {
    const calls = answering(200);
    await setNotification(4, { filter: 'unread', channels: ['web'] });
    expect(calls[0]).toMatchObject({
      input: '/api/users/self/notifications/4',
      init: { method: 'PUT', body: '{"filter":"unread","channels":["web"]}' },
    });
  });

  it('deletes the setting when no channel is ticked, and a feed that did not notify is fine', async () => {
    const calls = answering(404);
    await setNotification(4, { filter: 'unread', channels: [] });
    expect(calls[0]?.init?.method).toBe('DELETE');
  });

  it('throws the server’s refusal of a put', async () => {
    answering(404);
    await expect(
      setNotification(4, { filter: 'unread', channels: ['web'] }),
    ).rejects.toThrow();
  });
});
