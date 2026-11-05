import { createHmac } from 'node:crypto';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import { databaseFrom } from '@/domain/db/database';
import { Repository } from '@/domain/repository';
import { subscribeToHub } from '@/domain/websub';
import { APP_MIGRATIONS } from '../../../../lib/core/db/migrations';
import {
  installCloudflareContext,
  sqliteD1,
} from '../../../../lib/core/db/sqlite-d1';

const { GET, POST } = await import('@/app/webhooks/sources/[id]/route');

const TOPIC = 'https://a.test/f';
const FEED = '<rss><channel><title>A</title></channel></rss>';

let restore: () => void;
let repo: Repository;
let sourceId: number;

const context = (id: string | number) => ({
  params: Promise.resolve({ id: String(id) }),
});
const url = (id: string | number, query = '') =>
  `https://broadsheet.test/webhooks/sources/${id}${query}`;

beforeEach(async () => {
  const made = sqliteD1(...APP_MIGRATIONS);
  restore = installCloudflareContext(made.d1, {});
  const db = databaseFrom(made.d1);
  repo = new Repository(db);
  sourceId = (await repo.addFeed(1, TOPIC))!.source_id;
  jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(null, { status: 202 }));
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  await subscribeToHub(db, sourceId, { hub: 'https://hub.test/', self: TOPIC });
});

afterEach(() => {
  restore();
  jest.restoreAllMocks();
});

describe('GET /webhooks/sources/{id}', () => {
  it('echoes the challenge of the subscription it asked for', async () => {
    const query = `?hub.mode=subscribe&hub.topic=${encodeURIComponent(TOPIC)}&hub.challenge=xyz&hub.lease_seconds=60`;
    const response = await GET(
      new Request(url(sourceId, query)),
      context(sourceId),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('xyz');
  });

  it('refuses another topic', async () => {
    const query =
      '?hub.mode=subscribe&hub.topic=https://x.test/&hub.challenge=xyz';
    const response = await GET(
      new Request(url(sourceId, query)),
      context(sourceId),
    );
    expect(response.status).toBe(404);
  });

  it('refuses an id that is not one', async () => {
    const response = await GET(new Request(url('abc')), context('abc'));
    expect(response.status).toBe(404);
  });
});

describe('POST /webhooks/sources/{id}', () => {
  const push = async (id: number | string, signature?: string) =>
    POST(
      new Request(url(id), {
        method: 'POST',
        body: FEED,
        headers: signature ? { 'x-hub-signature': signature } : {},
      }),
      context(id),
    );

  it('takes a signed push', async () => {
    const secret = (await repo.sourceById(sourceId))!.websub_secret!;
    const signature = `sha256=${createHmac('sha256', secret).update(FEED).digest('hex')}`;
    expect((await push(sourceId, signature)).status).toBe(202);
    expect((await repo.sourceById(sourceId))!.last_fetched_at).not.toBeNull();
  });

  it('acknowledges and ignores an unsigned push', async () => {
    expect((await push(sourceId)).status).toBe(202);
    expect((await repo.sourceById(sourceId))!.last_fetched_at).toBeNull();
  });

  it('refuses a source with no subscription', async () => {
    expect((await push(999)).status).toBe(404);
  });
});
