import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import { SESSION_COOKIE } from '@/domain/auth/app';
import { Repository } from '@/domain/repository';
import { createDatabase } from '@/domain/db/client';
import { APP_MIGRATIONS } from '../../../../lib/core/db/migrations';
import {
  installCloudflareContext,
  settleBackground,
  sqliteD1,
} from '../../../../lib/core/db/sqlite-d1';
import {
  SESSION_SECRET,
  tokenFor,
} from '../../../../domain/auth/auth-test-kit';

const refreshSource = jest.fn<(...args: unknown[]) => Promise<unknown>>(
  async () => ({ ok: true, n: 0 }),
);
jest.unstable_mockModule('@/domain/scraping/index', () => ({
  refreshSource,
  discoverFeed: async (url: string) => url,
}));

const route = await import('@/app/api/feeds/imports/route');

const create = jest.fn<(options: unknown) => Promise<{ id: string }>>(
  async () => ({ id: 'run' }),
);

let restore: () => void;
let made: ReturnType<typeof sqliteD1>;
let repo: Repository;
let auth: Record<string, string>;
const origin = 'https://app.test';

beforeEach(async () => {
  refreshSource.mockClear();
  create.mockClear();
  made = sqliteD1(...APP_MIGRATIONS);
  restore = installCloudflareContext(made.d1, {
    SESSION_SECRET,
    FEED_IMPORTS: { create },
  });
  made.raw
    .prepare(
      'INSERT INTO users (id, google_sub, email, session_epoch) VALUES (7, ?, ?, 0), (8, ?, ?, 0)',
    )
    .run('g7', 'a@b.com', 'g8', 'b@b.com');
  repo = new Repository(createDatabase(made.d1));
  auth = {
    cookie: `${SESSION_COOKIE}=${await tokenFor({ id: 7 }, { ep: 0 })}`,
  };
});

afterEach(() => restore());

const post = (
  body: string,
  type: string,
  headers: Record<string, string> = auth,
) =>
  route.POST(
    new Request(`${origin}/api/feeds/imports`, {
      method: 'POST',
      headers: { ...headers, 'content-type': type },
      body,
    }),
  );
const opml = (body: string) =>
  `<opml version="2.0"><body>${body}</body></opml>`;

describe('POST /api/feeds/imports', () => {
  it('imports an OPML upload, answering 201 with Location and a summary', async () => {
    await repo.addFeed(7, 'https://a.test/old');
    const res = await post(
      opml(
        '<outline text="Tech"><outline xmlUrl="https://a.test/1" text="One"/></outline><outline xmlUrl="https://a.test/old"/><outline xmlUrl="javascript:x"/>',
      ),
      'text/x-opml',
    );
    expect(res.status).toBe(201);
    expect(res.headers.get('location')).toBe(`${origin}/api/feeds`);
    expect(await res.json()).toEqual({
      added: 1,
      skipped: 1,
      sections_added: 1,
      rejected: [
        {
          url: 'javascript:x',
          reason: 'url: must be an http or https address.',
        },
      ],
    });
    const feeds = await repo.listFeeds(7);
    expect(feeds.map((f) => [f.url, f.section_id])).toEqual([
      ['https://a.test/old', null],
      ['https://a.test/1', 1],
    ]);
    await settleBackground();
    expect(refreshSource).toHaveBeenCalledTimes(1);
  });

  it('seeds feeds and sections from topic ids', async () => {
    const res = await post(
      JSON.stringify({ topic_ids: ['design'] }),
      'application/json',
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ added: 2, sections_added: 1 });
    const sections = await repo.listSections(7);
    expect(sections.map((s) => s.name)).toEqual(['Design']);
  });

  it.each([
    ['no topic ids', '{}'],
    ['an empty list', '{"topic_ids":[]}'],
    ['non-string ids', '{"topic_ids":[1]}'],
    ['an unknown topic', '{"topic_ids":["nope"]}'],
  ])('answers 400 naming the field for %s', async (_name, body) => {
    const res = await post(body, 'application/json');
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    expect(((await res.json()) as { errors: string[] }).errors[0]).toMatch(
      /^topic_ids:/,
    );
  });

  it('answers 400 for OPML that is not OPML, or declares entities', async () => {
    const html = await post('<html/>', 'text/xml');
    expect(html.status).toBe(400);
    const doctype = await post('<!DOCTYPE a><opml></opml>', 'application/xml');
    expect(doctype.status).toBe(400);
  });

  it('answers 400 for a truncated upload, importing nothing', async () => {
    const res = await post(
      opml('<outline xmlUrl="https://a.test/1"/><outline text="cut'),
      'text/x-opml',
    );
    expect(res.status).toBe(400);
    expect(await repo.listFeeds(7)).toEqual([]);
  });

  it('creates nested sections for nested folders', async () => {
    await post(
      opml(
        '<outline text="A"><outline text="B"><outline xmlUrl="https://a.test/1"/></outline></outline>',
      ),
      'text/x-opml',
    );
    const sections = await repo.listSections(7);
    expect(sections.map((s) => [s.name, s.parent_id])).toEqual([
      ['A', null],
      ['B', sections[0]!.id],
    ]);
    const feeds = await repo.listFeeds(7);
    expect(feeds[0]?.section_id).toBe(sections[1]!.id);
  });

  it('answers 400 for more than 500 feeds', async () => {
    const many = Array.from(
      { length: 501 },
      (_, i) => `<outline xmlUrl="https://a.test/${i}"/>`,
    ).join('');
    const res = await post(opml(many), 'text/x-opml');
    expect(res.status).toBe(400);
    expect(await repo.listFeeds(7)).toEqual([]);
  });

  it('starts a Workflow for more than 50 feeds, answering 202 with where to watch it', async () => {
    const many = Array.from(
      { length: 51 },
      (_, i) => `<outline xmlUrl="https://a.test/${i}"/>`,
    ).join('');
    const res = await post(opml(many), 'text/x-opml');
    expect(res.status).toBe(202);
    const body = (await res.json()) as { id: string };
    expect(res.headers.get('location')).toBe(
      `${origin}/api/feeds/imports/${body.id}`,
    );
    expect(body).toEqual({
      id: body.id,
      status: 'running',
      total: 51,
      processed: 0,
      added: 0,
      skipped: 0,
      sections_added: 0,
      rejected: [],
    });
    expect(create).toHaveBeenCalledWith({
      id: body.id,
      params: {
        id: body.id,
        user: 7,
        feeds: expect.arrayContaining([{ url: 'https://a.test/50' }]),
      },
    });
    expect(await repo.listFeeds(7)).toEqual([]);
  });

  it('marks the import failed when its Workflow cannot start', async () => {
    create.mockRejectedValueOnce(new Error('no binding'));
    const many = Array.from(
      { length: 51 },
      (_, i) => `<outline xmlUrl="https://a.test/${i}"/>`,
    ).join('');
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await post(opml(many), 'text/x-opml');
    expect(res.status).toBe(500);
    expect(made.raw.prepare('SELECT status FROM feed_imports').all()).toEqual([
      { status: 'failed' },
    ]);
  });

  it('imports 50 feeds straight away', async () => {
    const many = Array.from(
      { length: 50 },
      (_, i) => `<outline xmlUrl="https://a.test/${i}"/>`,
    ).join('');
    const res = await post(opml(many), 'text/x-opml');
    expect(res.status).toBe(201);
    expect(create).not.toHaveBeenCalled();
  });

  it('answers 413 for an upload over 1 MiB', async () => {
    const res = await post('x'.repeat(1024 * 1024 + 1), 'text/x-opml');
    expect(res.status).toBe(413);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
  });

  it('answers 415 for another media type', async () => {
    const res = await post('hi', 'text/plain');
    expect(res.status).toBe(415);
  });

  it('answers 401 when nobody is signed in', async () => {
    const res = await post('{"topic_ids":["design"]}', 'application/json', {});
    expect(res.status).toBe(401);
    expect(await repo.listFeeds(7)).toEqual([]);
  });
});
