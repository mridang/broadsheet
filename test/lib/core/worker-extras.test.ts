import { afterEach, describe, expect, it, jest } from '@jest/globals';

const calls: string[] = [];
const failure = { error: undefined as Error | undefined };

jest.unstable_mockModule('@/lib/core/db/client', () => ({
  createDatabase: () => 'db',
}));

jest.unstable_mockModule('@/domain/scraping/index', () => ({
  refreshAll: async () => {
    calls.push('refreshAll');
    if (failure.error) {
      throw failure.error;
    }
  },
  backfillRecent: async (_db: unknown, _env: unknown, days: number) => {
    calls.push(`backfillRecent:${days}`);
  },
}));

const { default: extraHandlers } = await import('@/lib/core/worker-extras');

/** Fire the cron at the Worker and wait for the work it hands to `waitUntil`. */
async function fire() {
  const pending: Promise<unknown>[] = [];
  Reflect.apply(extraHandlers.scheduled as never, undefined, [
    { cron: '0 4 * * *' },
    { DB: {} },
    {
      waitUntil: (promise: Promise<unknown>) => {
        pending.push(promise);
      },
    },
  ]);
  await Promise.all(pending);
}

afterEach(() => {
  calls.length = 0;
  failure.error = undefined;
  jest.restoreAllMocks();
});

describe('scheduled', () => {
  it('scrapes every feed, then backfills the last week', async () => {
    await fire();
    expect(calls).toEqual(['refreshAll', 'backfillRecent:7']);
  });

  it('logs a failed scrape instead of letting it escape', async () => {
    const error = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    failure.error = new Error('feed down');
    await fire();
    expect(calls).toEqual(['refreshAll']);
    expect(String(error.mock.calls[0]?.[0])).toContain('scrape.failed');
    expect(String(error.mock.calls[0]?.[0])).toContain('feed down');
  });
});
