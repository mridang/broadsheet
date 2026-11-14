/**
 * @packageDocumentation
 *
 * `add_section`. Everything the tool is lives here: what the catalogue says about
 * it, the arguments it accepts, and what it does when called.
 */

import {
  parseSectionInput,
  sectionResource,
} from '@/domain/api/section-resource';
import { type ToolContext } from '@/domain/mcp/tool-context';
import { checked, dropUndefined, id } from '@/domain/mcp/tools/support';
import { ZodTool } from '@/domain/mcp/tools/zod-tool';
import { Repository } from '@/domain/repository';
import { type ToolAnnotations, writes } from '@/lib/mcp';
import { ToolFailureError } from '@/lib/mcp/server';
import { z } from 'zod';

/** What `add_section` accepts. */
const SCHEMA = z.object({
  name: z.string().describe('The heading.'),
  position: z
    .number()
    .int()
    .optional()
    .describe('Where it goes among its sibling sections, from 0.'),
  parent_id: id('parent section')
    .optional()
    .describe('Nest it under this section.'),
});

export class AddSectionTool extends ZodTool<'add_section', typeof SCHEMA> {
  readonly name = 'add_section';

  readonly title = 'Add a section';

  readonly description =
    'Add a heading to group feeds under on the front page, nested under another section when given one.';

  readonly input = SCHEMA;

  readonly annotations: ToolAnnotations = writes();

  protected override async runParsed(
    { parent_id, ...rest }: z.infer<typeof SCHEMA>,
    { uid, db }: ToolContext,
  ): Promise<object> {
    const { changes } = checked(
      parseSectionInput(
        {
          ...dropUndefined(rest),
          ...(parent_id === undefined ? {} : { parent_id: String(parent_id) }),
        },
        true,
      ),
    );
    const repo = new Repository(db);
    if (
      typeof changes.parent_id === 'number' &&
      !(await repo.canNestUnder(uid, undefined, changes.parent_id))
    ) {
      throw new ToolFailureError('There is no such parent section.');
    }
    const section = await repo.addSection(
      uid,
      changes.name!,
      changes.position,
      changes.parent_id ?? null,
    );
    return { section: sectionResource(section) };
  }
}
