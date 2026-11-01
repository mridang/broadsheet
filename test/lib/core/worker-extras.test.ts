import { afterEach, describe, expect, it, jest } from '@jest/globals';

const calls: string[] = [];
const failing = new Set<number>();
const refusing = new Set<number>();
const failingIssues = new Set<number>();
const failingPushes = new Set<number>();
const failingNotices = new Set<number>();

jest.unstable_mockModule(
  'cloudflare:workers',
  () => ({
    WorkflowEntrypoint: class {
      constructor(
        readonly ctx: unknown,
        readonly env: unknown,
      ) {}
    },
  }),
  { virtual: true },
);

jest.unstable_mockModule('@/domain/db/database', () => ({
  databaseFrom: () => 'db',
}));

jest.unstable_mockModule('@/domain/repository', () => ({
  Repository: class {
    dueSources = async () => [
      { id: 1, url: 'https://a.test/f', title: 'A' },
      { id: 2, url: 'https://b.test/f', title: 'B' },
    ];
    readerIds = async () => [7, 8];
    allCustomEditions = async () => [{ id: 30, user_id: 7 }];
    recordFetch = async (id: number, error?: string) => {
      calls.push(`recordFetch:${id}:${error}`);
    };
  },
}));

jest.unstable_mockModule('@/domain/scraping/index', () => ({
  FETCH_FAILED: 'The feed could not be fetched.',
  scrapeSource: async (
    _db: unknown,
    _env: unknown,
    source: { id: number },
    edition: string,
  ) => {
    calls.push(`scrape:${source.id}:${edition}`);
    if (failing.has(source.id)) throw new Error('feed down');
    if (refusing.has(source.id)) {
      return { articles: 0, failed: 'The feed answered HTTP 404.' };
    }
    return { articles: 5 };
  },
  backfillRecent: async (_db: unknown, _env: unknown, days: number) => {
    calls.push(`backfillRecent:${days}`);
  },
}));

jest.unstable_mockModule('@/domain/clustering', () => ({
  clusterEdition: async (_db: unknown, _env: unknown, edition: string) => {
    calls.push(`cluster:${edition}`);
    return { articles: 10, clusters: 1 };
  },
}));

jest.unstable_mockModule('@/domain/issues', () => ({
  publishIssue: async (
    _db: unknown,
    _env: unknown,
    user: number,
    date: string,
  ) => {
    calls.push(`issue:${user}:${date}`);
    if (failingIssues.has(user)) throw new Error('model down');
    return 3;
  },
  publishEditionIssue: async (
    _db: unknown,
    _env: unknown,
    edition: { id: number },
    date: string,
  ) => {
    calls.push(`edition:${edition.id}:${date}`);
    if (failingIssues.has(edition.id)) throw new Error('model down');
    return 2;
  },
}));

jest.unstable_mockModule('@/domain/notify', () => ({
  sendIssueReady: async (
    _env: unknown,
    _db: unknown,
    user: number,
    date: string,
  ) => {
    calls.push(`push:${user}:${date}`);
    if (failingPushes.has(user)) throw new Error('database down');
    return { sent: 1, failed: 0, removed: 0 };
  },
  notifyNewStories: async (
    _env: unknown,
    _db: unknown,
    user: number,
    date: string,
  ) => {
    calls.push(`notice:${user}:${date}`);
    if (failingNotices.has(user)) throw new Error('database down');
    return { stories: 1, pushed: 1, emailed: 0, hooked: 0 };
  },
}));

jest.unstable_mockModule('@/domain/notifications', () => ({
  NotificationRepository: class {
    notifiedUserIds = async () => [7];
  },
}));

const { default: extraHandlers, DailyScrape } =
  await import('@/lib/core/worker-extras');

/** A step runner like the Workflows one: names each step and runs it once. */
const step = {
  do: async (name: string, ...rest: unknown[]) => {
    calls.push(`step:${name}`);
    const run = rest.at(-1) as () => Promise<unknown>;
    return run();
  },
};

/** Run the Workflow as if started on 1 November 2026. */
const run = () =>
  Reflect.apply(DailyScrape.prototype.run, { env: { DB: {} } }, [
    { timestamp: new Date('2026-11-01T06:00:00Z'), payload: {} },
    step,
  ]) as Promise<{ sources: number; ok: number; articles: number }>;

afterEach(() => {
  calls.length = 0;
  failing.clear();
  refusing.clear();
  failingIssues.clear();
  failingPushes.clear();
  failingNotices.clear();
  jest.restoreAllMocks();
});

describe('DailyScrape', () => {
  it('fetches each source, clusters the edition, backfills, then lays out each issue', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(await run()).toEqual({ sources: 2, ok: 2, articles: 10 });
    expect(calls).toEqual([
      'step:list sources',
      'step:fetch source 1',
      'scrape:1:2026-11-01',
      'step:fetch source 2',
      'scrape:2:2026-11-01',
      'step:cluster edition',
      'cluster:2026-11-01',
      'step:list notified readers',
      'step:notify new stories for user 7',
      'notice:7:2026-11-01',
      'step:backfill recent editions',
      'backfillRecent:7',
      'step:list readers',
      'step:lay out issue for user 7',
      'issue:7:2026-11-01',
      'step:notify user 7',
      'push:7:2026-11-01',
      'step:lay out issue for user 8',
      'issue:8:2026-11-01',
      'step:notify user 8',
      'push:8:2026-11-01',
      'step:list custom editions',
      'step:lay out issue for edition 30',
      'edition:30:2026-11-01',
    ]);
  });

  it('records a source that still fails and moves on', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    failing.add(1);
    expect(await run()).toEqual({ sources: 2, ok: 1, articles: 5 });
    expect(calls).toContain('step:record failure of source 1');
    expect(calls).toContain('recordFetch:1:feed down');
    expect(calls).toContain('scrape:2:2026-11-01');
  });

  it('counts a source whose answer was refused without retrying or recording it again', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    refusing.add(1);
    expect(await run()).toEqual({ sources: 2, ok: 1, articles: 5 });
    expect(calls).not.toContain('step:record failure of source 1');
  });
});

describe('DailyScrape issues', () => {
  it('logs an issue that still fails and lays out the next reader', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    failingIssues.add(7);
    await run();
    expect(String(error.mock.calls[0]?.[0])).toContain('issue.failed');
    expect(calls).toContain('issue:8:2026-11-01');
  });
});

describe('DailyScrape notifications', () => {
  it('does not notify a reader whose issue failed', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    failingIssues.add(7);
    await run();
    expect(calls).not.toContain('push:7:2026-11-01');
    expect(calls).toContain('push:8:2026-11-01');
  });

  it('logs new-story notifications that fail and goes on', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    failingNotices.add(7);
    await run();
    expect(String(error.mock.calls[0]?.[0])).toContain('notification.failed');
    expect(calls).toContain('issue:7:2026-11-01');
  });

  it('logs a notification that fails and notifies the next reader', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    failingPushes.add(7);
    await run();
    expect(String(error.mock.calls[0]?.[0])).toContain('push.failed');
    expect(calls).toContain('push:8:2026-11-01');
  });
});

describe('DailyScrape custom editions', () => {
  it('logs an edition issue that still fails', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    failingIssues.add(30);
    await run();
    expect(String(error.mock.calls[0]?.[0])).toContain('"edition":30');
  });
});

describe('scheduled', () => {
  const fire = (create: () => Promise<{ id: string }>) =>
    Reflect.apply(extraHandlers.scheduled as never, undefined, [
      { cron: '0 6 * * *' },
      { DAILY_SCRAPE: { create } },
      { waitUntil: () => undefined },
    ]) as Promise<void>;

  it('starts a daily scrape run', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const create = jest.fn(async () => ({ id: 'run-1' }));
    await fire(create);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('logs a run that could not start instead of letting it escape', async () => {
    const error = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    await fire(async () => {
      throw new Error('no binding');
    });
    expect(String(error.mock.calls[0]?.[0])).toContain('scrape.failed');
    expect(String(error.mock.calls[0]?.[0])).toContain('no binding');
  });
});
