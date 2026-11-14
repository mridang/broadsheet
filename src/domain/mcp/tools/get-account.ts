/**
 * @packageDocumentation
 *
 * `get_account`. Everything the tool is lives here: what the catalogue says about
 * it, the arguments it accepts, and what it does when called.
 */

import { type ToolContext } from '@/domain/mcp/tool-context';
import { ZodTool } from '@/domain/mcp/tools/zod-tool';
import { Repository } from '@/domain/repository';
import { READS, type ToolAnnotations } from '@/lib/mcp';
import { ToolFailureError } from '@/lib/mcp/server';
import { z } from 'zod';

/** What `get_account` accepts. */
const SCHEMA = z.object({});

export class GetAccountTool extends ZodTool<'get_account', typeof SCHEMA> {
  readonly name = 'get_account';

  readonly title = 'Get the account';

  readonly description =
    'Who the person is, and how many feeds, sections, saved stories and classifiers they have.';

  readonly input = SCHEMA;

  readonly annotations: ToolAnnotations = READS;

  protected override async runParsed(
    _args: z.infer<typeof SCHEMA>,
    { uid, db }: ToolContext,
  ): Promise<object> {
    const repo = new Repository(db);
    const [user, feeds, sections, saves, training] = await Promise.all([
      repo.getUser(uid),
      repo.listFeeds(uid),
      repo.listSections(uid),
      repo.listSaves(uid),
      repo.listClassifiers(uid),
    ]);
    if (!user) throw new ToolFailureError('There is no such account.');
    return {
      email: user.email,
      ...(user.name ? { name: user.name } : {}),
      feeds: feeds.length,
      sections: sections.length,
      saved: saves.length,
      classifiers: training.length,
    };
  }
}
