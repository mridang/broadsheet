/**
 * @packageDocumentation
 *
 * `remove_section`. Everything the tool is lives here: what the catalogue says about
 * it, the arguments it accepts, and what it does when called.
 */

import { type ToolContext } from '@/domain/mcp/tool-context';
import { ToolFailureError } from '@/domain/mcp/tool-failure';
import { JsonTool } from '@/domain/mcp/tools/json-tool';
import { id } from '@/domain/mcp/tools/support';
import { Repository } from '@/domain/repository';
import { type ToolAnnotations, writes } from '@/lib/mcp';
import { z } from 'zod';

/** What `remove_section` accepts. */
const SCHEMA = z.object({ section_id: id('section') });

export class RemoveSectionTool extends JsonTool<
  'remove_section',
  typeof SCHEMA
> {
  readonly name = 'remove_section';

  readonly title = 'Remove a section';

  readonly description =
    'Remove a section. Its feeds stay followed and move to the top of the paper.';

  readonly input = SCHEMA;

  readonly annotations: ToolAnnotations = writes({ destructive: true });

  protected override async runParsed(
    { section_id }: z.infer<typeof SCHEMA>,
    { user, services }: ToolContext,
  ): Promise<object> {
    const uid = user.id;
    const db = services.openDatabase();
    if (!(await new Repository(db).removeSection(uid, section_id))) {
      throw new ToolFailureError('There is no such section.');
    }
    return { removed: true };
  }
}
