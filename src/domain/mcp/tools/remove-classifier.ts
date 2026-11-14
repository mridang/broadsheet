/**
 * @packageDocumentation
 *
 * `remove_classifier`. Everything the tool is lives here: what the catalogue says about
 * it, the arguments it accepts, and what it does when called.
 */

import { type ToolContext } from '@/domain/mcp/tool-context';
import { JsonTool } from '@/domain/mcp/tools/json-tool';
import { id } from '@/domain/mcp/tools/support';
import { Repository } from '@/domain/repository';
import { type ToolAnnotations, ToolFailureError, writes } from '@/lib/mcp';
import { z } from 'zod';

/** What `remove_classifier` accepts. */
const SCHEMA = z.object({ classifier_id: id('classifier') });

export class RemoveClassifierTool extends JsonTool<
  'remove_classifier',
  typeof SCHEMA
> {
  readonly name = 'remove_classifier';

  readonly title = 'Remove training';

  readonly description =
    'Remove one like or dislike, by its id from list_classifiers.';

  readonly input = SCHEMA;

  readonly annotations: ToolAnnotations = writes({ destructive: true });

  protected override async runParsed(
    { classifier_id }: z.infer<typeof SCHEMA>,
    { uid, db }: ToolContext,
  ): Promise<object> {
    if (!(await new Repository(db).removeClassifier(uid, classifier_id))) {
      throw new ToolFailureError('There is no such classifier.');
    }
    return { removed: true };
  }
}
