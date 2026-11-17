import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { createDatabase } from '@/domain/db/client';
import { ToolFailureError } from '@/domain/mcp/tool-failure';
import { callTool } from '@/domain/mcp/tool-calls';
import { Repository } from '@/domain/repository';
import { APP_MIGRATIONS } from '../../../lib/core/db/migrations';
import { sqliteD1 } from '../../../lib/core/db/sqlite-d1';
import type { Database } from '@/domain/db/client';
import type { ToolContext } from '@/domain/mcp/tool-context';
import type { ToolServices } from '@/domain/mcp/tool-services';
import type { User } from '@/domain/db/users';
import type { AnswerModel } from '@/domain/assistant';

let db: Database;
let ctx: ToolContext;
let refresh: jest.Mock<ToolServices['refresh']>;

/** The context of a call by this person, with this model bound when there is one. */
const asCaller = (uid: number, model?: AnswerModel): ToolContext => ({
  user: { id: uid } as User,
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

describe('classifiers', () => {
  it('adds a like and lists it', async () => {
    await run('add_classifier', {
      kind: 'source',
      value: 'a.test',
      score: 'like',
    });
    expect(await run('list_classifiers')).toMatchObject({
      classifiers: [{ kind: 'source', value: 'a.test', score: 'like' }],
    });
  });

  it('refuses a blank value', async () => {
    await expect(
      run('add_classifier', { kind: 'title', value: ' ', score: 'like' }),
    ).rejects.toThrow('value: must be a non-blank string.');
  });

  it('refuses a feed classifier on a feed the person does not follow', async () => {
    await expect(
      run('add_classifier', { kind: 'feed', value: '999', score: 'like' }),
    ).rejects.toThrow('value: no such feed.');
  });

  it('adds a super dislike', async () => {
    expect(
      await run('add_classifier', {
        kind: 'text',
        value: 'sponsored',
        score: 'super_dislike',
      }),
    ).toMatchObject({ classifier: { score: 'super_dislike' } });
  });

  it('removes one', async () => {
    const { classifier } = (await run('add_classifier', {
      kind: 'title',
      value: 'Go',
      score: 'dislike',
    })) as { classifier: { id: string } };
    expect(
      await run('remove_classifier', { classifier_id: Number(classifier.id) }),
    ).toEqual({ removed: true });
  });

  it('refuses to remove an unknown one', async () => {
    await expect(
      run('remove_classifier', { classifier_id: 999 }),
    ).rejects.toThrow('There is no such classifier.');
  });
});
