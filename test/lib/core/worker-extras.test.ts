import { afterEach, describe, expect, it, jest } from '@jest/globals';

const calls: string[] = [];
const failing = new Set<number>();
const refusing = new Set<number>();
const failingIssues = new Set<number>();
const failingPushes = new Set<number>();
const failingNotices = new Set<number>();
const written = new Set<string>();
const failingBriefings = new Set<number>();
const thinBriefings = new Set<number>();

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
  DEFAULT_PREFERENCES: { briefing_enabled: true },
  Repository: class {
    dueSources = async () => [
      { id: 1, url: 'https://a.test/f', title: 'A' },
      { id: 2, url: 'https://b.test/f', title: 'B' },
    ];
    readerIds = async () => [7, 8];
    allPreferences = async () => new Map([[8, { briefing_enabled: false }]]);
    findBriefing = async (user: number, slot: string, date: string) =>
      written.has(`${user}:${slot}:${date}`) ? { id: 1 } : undefined;
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

jest.unstable_mockModule('@/domain/briefings', () => ({
  dueSlots: (prefs: { briefing_enabled: boolean }) =>
    prefs.briefing_enabled
      ? [
          { slot: 'morning', date: '2026-11-01' },
          { slot: 'evening', date: '2026-11-01' },
        ]
      : [],
  writeScheduledBriefing: async (
    _db: unknown,
    _env: unknown,
    user: number,
    slot: string,
    date: string,
  ) => {
    calls.push(`brief:${user}:${slot}:${date}`);
    if (failingBriefings.has(user)) throw new Error('model down');
    if (thinBriefings.has(user))
      return { briefing: undefined, replaced: false };
    return {
      briefing: { id: 40, title: 'Morning', status: 'complete' },
      replaced: false,
    };
  },
}));

jest.unstable_mockModule('@/domain/notify', () => ({
  sendBriefingReady: async (
    _env: unknown,
    _db: unknown,
    user: number,
    id: number,
  ) => {
    calls.push(`briefing-push:${user}:${id}`);
    return { sent: 1, failed: 0, removed: 0 };
  },
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
    ruleUserIds = async () => [7, 9];
  },
}));

const {
  default: extraHandlers,
  BriefingRun,
  DailyScrape,
  dueBriefings,
  isDailyRun,
} = await import('@/lib/core/worker-extras');
const { Repository } = await import('@/domain/repository');

/** A step runner like the Workflows one: names each step and runs it once. */
const step = {
  do: async (name: string, ...rest: unknown[]) => {
    calls.push(`step:${name}`);
    const run = rest.at(-1) as () => Promise<unknown>;
    return run();
  },
};

/** Run the Workflow as if started on 1 November 2026. */
const run = (payload: { fetchOnly?: boolean } = {}) =>
  Reflect.apply(DailyScrape.prototype.run, { env: { DB: {} } }, [
    { timestamp: new Date('2026-11-01T06:00:00Z'), payload },
    step,
  ]) as Promise<{ sources: number; ok: number; articles: number }>;

afterEach(() => {
  written.clear();
  failingBriefings.clear();
  thinBriefings.clear();
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
      'step:notify new stories for user 9',
      'notice:9:2026-11-01',
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

describe('DailyScrape fetch-only runs', () => {
  it('fetches the due sources and stops there', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(await run({ fetchOnly: true })).toEqual({
      sources: 2,
      ok: 2,
      articles: 10,
    });
    expect(calls.filter((c) => c.startsWith('step:'))).toEqual([
      'step:list sources',
      'step:fetch source 1',
      'step:fetch source 2',
    ]);
  });
});

describe('isDailyRun', () => {
  it.each([
    ['2026-11-01T06:00:00Z', true],
    ['2026-11-01T06:04:59Z', true],
    ['2026-11-01T06:05:00Z', false],
    ['2026-11-01T05:55:00Z', false],
    ['2026-11-01T18:00:00Z', false],
  ])('at %s is %s', (time, daily) => {
    expect(isDailyRun(Date.parse(time))).toBe(daily);
  });
});

describe('scheduled', () => {
  const fire = (
    create: (options: unknown) => Promise<{ id: string }>,
    time = '2026-11-01T06:00:00Z',
  ) =>
    Reflect.apply(extraHandlers.scheduled as never, undefined, [
      { cron: '*/5 * * * *', scheduledTime: Date.parse(time) },
      { DAILY_SCRAPE: { create } },
      { waitUntil: () => undefined },
    ]) as Promise<void>;

  it('starts the whole daily run at 06:00 UTC', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const create = jest.fn<(options: unknown) => Promise<{ id: string }>>(
      async () => ({ id: 'run-1' }),
    );
    await fire(create);
    expect(create).toHaveBeenCalledWith({ params: { fetchOnly: false } });
  });

  it('starts a fetch of the due sources the rest of the day', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const create = jest.fn<(options: unknown) => Promise<{ id: string }>>(
      async () => ({ id: 'run-2' }),
    );
    await fire(create, '2026-11-01T13:35:00Z');
    expect(create).toHaveBeenCalledWith({ params: { fetchOnly: true } });
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

describe('dueBriefings', () => {
  it('lists the slots due for each reader with briefings on', async () => {
    expect(
      await dueBriefings(new Repository('db' as never), new Date()),
    ).toEqual([
      { user: 7, slot: 'morning', date: '2026-11-01' },
      { user: 7, slot: 'evening', date: '2026-11-01' },
    ]);
  });

  it('leaves out a slot already written', async () => {
    written.add('7:morning:2026-11-01');
    expect(
      (await dueBriefings(new Repository('db' as never), new Date())).map(
        (d) => d.slot,
      ),
    ).toEqual(['evening']);
  });
});

describe('BriefingRun', () => {
  const brief = (due: { user: number; slot: string; date: string }[]) =>
    Reflect.apply(BriefingRun.prototype.run, { env: { DB: {} } }, [
      { payload: { due, at: '2026-11-01T08:30:00Z' } },
      step,
    ]) as Promise<{ due: number; written: number }>;

  it('writes each due briefing as its own step and pushes a notice', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(
      await brief([{ user: 7, slot: 'morning', date: '2026-11-01' }]),
    ).toEqual({ due: 1, written: 1 });
    expect(calls).toEqual([
      'step:brief user 7 morning 2026-11-01',
      'brief:7:morning:2026-11-01',
      'step:notify user 7 of briefing 40',
      'briefing-push:7:40',
    ]);
  });

  it('skips a briefing another run wrote meanwhile', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    written.add('7:morning:2026-11-01');
    expect(
      await brief([{ user: 7, slot: 'morning', date: '2026-11-01' }]),
    ).toEqual({ due: 1, written: 0 });
    expect(calls).not.toContain('brief:7:morning:2026-11-01');
  });

  it('pushes nothing when too few stories made a briefing', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    thinBriefings.add(7);
    await brief([{ user: 7, slot: 'morning', date: '2026-11-01' }]);
    expect(calls.some((c) => c.startsWith('briefing-push'))).toBe(false);
  });

  it('logs a briefing that still fails and writes the next', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    failingBriefings.add(7);
    expect(
      await brief([
        { user: 7, slot: 'morning', date: '2026-11-01' },
        { user: 9, slot: 'morning', date: '2026-11-01' },
      ]),
    ).toEqual({ due: 2, written: 1 });
    expect(String(error.mock.calls[0]?.[0])).toContain('briefing.failed');
  });
});

describe('scheduled briefings', () => {
  const scrape = jest.fn<(opts: unknown) => Promise<{ id: string }>>(
    async () => ({ id: 'scrape' }),
  );
  const fire = (create: (opts: unknown) => Promise<{ id: string }>) =>
    Reflect.apply(extraHandlers.scheduled as never, undefined, [
      {
        cron: '*/5 * * * *',
        scheduledTime: Date.parse('2026-11-01T08:30:00Z'),
      },
      { DB: {}, DAILY_SCRAPE: { create: scrape }, BRIEFINGS: { create } },
      { waitUntil: () => undefined },
    ]) as Promise<void>;

  it('starts a briefing run with what came due, after the scrape', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const create = jest.fn<(opts: unknown) => Promise<{ id: string }>>(
      async () => ({ id: 'run-2' }),
    );
    await fire(create);
    expect(scrape).toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith({
      params: {
        due: [
          { user: 7, slot: 'morning', date: '2026-11-01' },
          { user: 7, slot: 'evening', date: '2026-11-01' },
        ],
        at: '2026-11-01T08:30:00.000Z',
      },
    });
  });

  it('starts nothing when nothing is due', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    written.add('7:morning:2026-11-01');
    written.add('7:evening:2026-11-01');
    const create = jest.fn<(opts: unknown) => Promise<{ id: string }>>(
      async () => ({ id: 'run-2' }),
    );
    await fire(create);
    expect(create).not.toHaveBeenCalled();
  });

  it('logs a briefing run that could not start', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    await fire(async () => {
      throw new Error('no binding');
    });
    expect(
      error.mock.calls.some((c) => String(c[0]).includes('briefings.failed')),
    ).toBe(true);
  });

  it('still checks briefings when the scrape could not start', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    scrape.mockRejectedValueOnce(new Error('down'));
    const create = jest.fn<(opts: unknown) => Promise<{ id: string }>>(
      async () => ({ id: 'run-2' }),
    );
    await fire(create);
    expect(create).toHaveBeenCalled();
  });
});
