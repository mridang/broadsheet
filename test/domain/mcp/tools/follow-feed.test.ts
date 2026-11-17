import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { createDatabase } from '@/domain/db/client';
import { ToolFailureError } from '@/domain/mcp/tool-failure';
import { callTool } from '@/domain/mcp/tool-calls';
import { Repository } from '@/domain/repository';
import { APP_MIGRATIONS } from '../../../lib/core/db/migrations';
import { sqliteD1 } from '../../../lib/core/db/sqlite-d1';
import insecure from '../../../fixtures/insecure-urls.json';
import { fixtureUser } from '../../fixtures';
import type { ToolContext } from '@/domain/mcp/tool-context';
import type { ToolServices } from '@/domain/mcp/tool-services';
import type { AnswerModel } from '@/domain/assistant';
import type { Database } from '@/domain/db/client';

let db: Database;
let ctx: ToolContext;
let refresh: jest.Mock<ToolServices['refresh']>;

/** The context of a call by this person, with this model bound when there is one. */
const asCaller = (uid: number, model?: AnswerModel): ToolContext => ({
  user: fixtureUser({ id: uid }),
  services: { openDatabase: () => db, refresh, ...(model && { model }) },
});

beforeEach(async () => {
  db = createDatabase(sqliteD1(...APP_MIGRATIONS).d1);
  const repo = new Repository(db);
  await repo.upsertUser({ sub: 'g1', email: 'a@b.com' });
  await repo.upsertUser({ sub: 'g2', email: 'c@d.com' });
  refresh = jest.fn<ToolServices['refresh']>();
  ctx = asCaller(1);
});

/** Run a tool by name with arguments parsed as `tools/call` would. */
async function run(name: string, args: Record<string, unknown> = {}) {
  const result = await callTool(
    ctx.user,
    { name, arguments: args },
    ctx.services,
  );
  if (result.isError) {
    throw new ToolFailureError(result.content[0]?.text ?? '');
  }
  return result.structuredContent;
}

describe('follow_feed', () => {
  it('follows a new feed and fetches it', async () => {
    expect(
      await run('follow_feed', { url: 'https://n.test/rss' }),
    ).toMatchObject({ created: true, feed: { url: 'https://n.test/rss' } });
    expect(refresh).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://n.test/rss' }),
    );
  });

  it('returns a feed already followed unchanged', async () => {
    await run('follow_feed', { url: 'https://n.test/rss' });
    expect(
      await run('follow_feed', { url: 'https://n.test/rss' }),
    ).toMatchObject({ created: false });
  });

  it('refuses an address that is not http', async () => {
    await expect(run('follow_feed', { url: insecure.ftpBare })).rejects.toThrow(
      'url: must be an http or https address.',
    );
  });
});

describe('follow_feed into a section', () => {
  it('files the new feed', async () => {
    const section = await new Repository(db).addSection(1, 'Tech');
    expect(
      await run('follow_feed', {
        url: 'https://n.test/rss',
        section_id: section.id,
      }),
    ).toMatchObject({ feed: { section_id: String(section.id) } });
  });

  it("refuses another person's section", async () => {
    const section = await new Repository(db).addSection(2, 'Theirs');
    await expect(
      run('follow_feed', { url: 'https://n.test/rss', section_id: section.id }),
    ).rejects.toThrow('There is no such section.');
  });
});
