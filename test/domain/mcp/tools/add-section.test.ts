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

describe('sections', () => {
  it('adds one', async () => {
    expect(await run('add_section', { name: 'Tech' })).toMatchObject({
      section: { name: 'Tech' },
    });
  });

  it('refuses a blank name', async () => {
    await expect(run('add_section', { name: ' ' })).rejects.toThrow(
      'name: must be a non-blank string.',
    );
  });

  it('renames one', async () => {
    const section = await new Repository(db).addSection(1, 'Tech');
    expect(
      await run('update_section', { section_id: section.id, name: 'Science' }),
    ).toMatchObject({ section: { name: 'Science' } });
  });

  it("refuses to rename another person's", async () => {
    const section = await new Repository(db).addSection(2, 'Theirs');
    await expect(
      run('update_section', { section_id: section.id, name: 'Mine' }),
    ).rejects.toThrow('There is no such section.');
  });

  it('removes one', async () => {
    const section = await new Repository(db).addSection(1, 'Tech');
    expect(await run('remove_section', { section_id: section.id })).toEqual({
      removed: true,
    });
  });

  it("refuses to remove another person's", async () => {
    const section = await new Repository(db).addSection(2, 'Theirs');
    await expect(
      run('remove_section', { section_id: section.id }),
    ).rejects.toThrow('There is no such section.');
  });
});

describe('nested sections', () => {
  it('adds a section under another', async () => {
    const top = await new Repository(db).addSection(1, 'Top');
    expect(
      await run('add_section', { name: 'Inner', parent_id: top.id }),
    ).toMatchObject({ section: { parent_id: String(top.id) } });
  });

  it("refuses another person's parent", async () => {
    const theirs = await new Repository(db).addSection(2, 'Theirs');
    await expect(
      run('add_section', { name: 'x', parent_id: theirs.id }),
    ).rejects.toThrow('There is no such parent section.');
  });

  it('refuses to nest a section inside itself', async () => {
    const top = await new Repository(db).addSection(1, 'Top');
    await expect(
      run('update_section', { section_id: top.id, parent_id: top.id }),
    ).rejects.toThrow('The parent must be another of your sections');
  });

  it('moves a section to the top level', async () => {
    const repo = new Repository(db);
    const top = await repo.addSection(1, 'Top');
    const inner = await repo.addSection(1, 'Inner', undefined, top.id);
    const { section } = (await run('update_section', {
      section_id: inner.id,
      parent_id: null,
    })) as { section: object };
    expect(section).not.toHaveProperty('parent_id');
  });
});
