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
import { databaseFrom } from '@/domain/db/database';
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
jest.unstable_mockModule('@/domain/scraping/index', () => ({ refreshSource }));

const route = await import('@/app/api/feeds/imports/route');

let restore: () => void;
let repo: Repository;
let auth: Record<string, string>;
const origin = 'https://app.test';

beforeEach(async () => {
  refreshSource.mockClear();
  const made = sqliteD1(...APP_MIGRATIONS);
  restore = installCloudflareContext(made.d1, { SESSION_SECRET });
  made.raw
    .prepare(
      'INSERT INTO users (id, google_sub, email, session_epoch) VALUES (7, ?, ?, 0), (8, ?, ?, 0)',
    )
    .run('g7', 'a@b.com', 'g8', 'b@b.com');
  repo = new Repository(databaseFrom(made.d1));
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
    expect((await repo.listFeeds(7)).map((f) => [f.url, f.section_id])).toEqual(
      [
        ['https://a.test/old', null],
        ['https://a.test/1', 1],
      ],
    );
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
    expect((await repo.listSections(7)).map((s) => s.name)).toEqual(['Design']);
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
    expect((await post('<html/>', 'text/xml')).status).toBe(400);
    expect(
      (await post('<!DOCTYPE a><opml></opml>', 'application/xml')).status,
    ).toBe(400);
  });

  it('answers 400 for more than 500 feeds', async () => {
    const many = Array.from(
      { length: 501 },
      (_, i) => `<outline xmlUrl="https://a.test/${i}"/>`,
    ).join('');
    expect((await post(opml(many), 'text/x-opml')).status).toBe(400);
    expect(await repo.listFeeds(7)).toEqual([]);
  });

  it('answers 413 for an upload over 1 MiB', async () => {
    const res = await post('x'.repeat(1024 * 1024 + 1), 'text/x-opml');
    expect(res.status).toBe(413);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
  });

  it('answers 415 for another media type', async () => {
    expect((await post('hi', 'text/plain')).status).toBe(415);
  });

  it('answers 401 when nobody is signed in', async () => {
    const res = await post('{"topic_ids":["design"]}', 'application/json', {});
    expect(res.status).toBe(401);
    expect(await repo.listFeeds(7)).toEqual([]);
  });
});
