/**
 * @packageDocumentation
 *
 * `update_section`. Everything the tool is lives here: what the catalogue says about
 * it, the arguments it accepts, and what it does when called.
 */

import {
  parseSectionInput,
  sectionResource,
} from '@/domain/api/section-resource';
import { type ToolContext } from '@/domain/mcp/tool-context';
import { JsonTool } from '@/domain/mcp/tools/json-tool';
import { checked, dropUndefined, id } from '@/domain/mcp/tools/support';
import { Repository } from '@/domain/repository';
import { type ToolAnnotations, ToolFailureError, writes } from '@/lib/mcp';
import { z } from 'zod';

/** What `update_section` accepts. */
const SCHEMA = z.object({
  section_id: id('section'),
  name: z.string().optional().describe('The new heading.'),
  position: z
    .number()
    .int()
    .optional()
    .describe('Where it goes among its sibling sections, from 0.'),
  parent_id: id('parent section')
    .nullable()
    .optional()
    .describe('Nest it under this section; null moves it to the top level.'),
});

export class UpdateSectionTool extends JsonTool<
  'update_section',
  typeof SCHEMA
> {
  readonly name = 'update_section';

  readonly title = 'Rename or move a section';

  readonly description =
    'Rename a section, change where it goes, or nest it under another section (null for the top level).';

  readonly input = SCHEMA;

  readonly annotations: ToolAnnotations = writes();

  protected override async runParsed(
    { section_id, parent_id, ...rest }: z.infer<typeof SCHEMA>,
    { uid, db }: ToolContext,
  ): Promise<object> {
    const { changes } = checked(
      parseSectionInput(
        {
          ...dropUndefined(rest),
          ...(parent_id === undefined
            ? {}
            : { parent_id: parent_id === null ? null : String(parent_id) }),
        },
        false,
      ),
    );
    const repo = new Repository(db);
    if (!(await repo.getSection(uid, section_id))) {
      throw new ToolFailureError('There is no such section.');
    }
    if (
      typeof changes.parent_id === 'number' &&
      !(await repo.canNestUnder(uid, section_id, changes.parent_id))
    ) {
      throw new ToolFailureError(
        'The parent must be another of your sections, not one inside this one.',
      );
    }
    const section = await repo.updateSection(uid, section_id, changes);
    if (!section) throw new ToolFailureError('There is no such section.');
    return { section: sectionResource(section) };
  }
}
