/**
 * @packageDocumentation
 *
 * `get_account`. Everything the tool is lives here: what the catalogue says about
 * it, the arguments it accepts, and what it does when called.
 */

import { type ToolContext } from '@/domain/mcp/tool-context';
import { ToolFailureError } from '@/domain/mcp/tool-failure';
import { JsonTool } from '@/domain/mcp/tools/json-tool';
import { Repository } from '@/domain/repository';
import { READS, type ToolAnnotations } from '@/lib/mcp';
import { z } from 'zod';

/** What `get_account` accepts. */
const SCHEMA = z.object({});

export class GetAccountTool extends JsonTool<'get_account', typeof SCHEMA> {
  readonly name = 'get_account';

  readonly title = 'Get the account';

  readonly description =
    'Who the person is, and how many feeds, sections, saved stories and classifiers they have.';

  readonly input = SCHEMA;

  readonly annotations: ToolAnnotations = READS;

  protected override async runParsed(
    _args: z.infer<typeof SCHEMA>,
    { user, services }: ToolContext,
  ): Promise<object> {
    const uid = user.id;
    const db = services.openDatabase();
    const repo = new Repository(db);
    const [account, feeds, sections, saves, training] = await Promise.all([
      repo.getUser(uid),
      repo.listFeeds(uid),
      repo.listSections(uid),
      repo.listSaves(uid),
      repo.listClassifiers(uid),
    ]);
    if (!account) throw new ToolFailureError('There is no such account.');
    return {
      email: account.email,
      ...(account.name ? { name: account.name } : {}),
      feeds: feeds.length,
      sections: sections.length,
      saved: saves.length,
      classifiers: training.length,
    };
  }
}
