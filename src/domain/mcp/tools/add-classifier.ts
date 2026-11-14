/**
 * @packageDocumentation
 *
 * `add_classifier`. Everything the tool is lives here: what the catalogue says about
 * it, the arguments it accepts, and what it does when called.
 */

import {
  classifierResource,
  parseClassifierInput,
} from '@/domain/api/classifier-resource';
import { type ToolContext } from '@/domain/mcp/tool-context';
import { JsonTool } from '@/domain/mcp/tools/json-tool';
import { checked, id } from '@/domain/mcp/tools/support';
import { verdict } from '@/domain/render/tiers';
import { Repository } from '@/domain/repository';
import { type ToolAnnotations, ToolFailureError, writes } from '@/lib/mcp';
import { z } from 'zod';

/** What `add_classifier` accepts. */
const SCHEMA = z.object({
  kind: z
    .enum(['title', 'author', 'tag', 'text', 'url', 'feed', 'source'])
    .describe('What to match on.'),
  value: z
    .string()
    .describe(
      'The title words, author, tag, text, part of the address, feed id or site.',
    ),
  score: z
    .enum(['like', 'dislike', 'super_dislike'])
    .describe('Whether to like, dislike or super dislike.'),
});

export class AddClassifierTool extends JsonTool<
  'add_classifier',
  typeof SCHEMA
> {
  readonly name = 'add_classifier';

  readonly title = 'Train the paper';

  readonly description =
    'Like or dislike stories by title words, author, tag, text, address, feed or site. Liked stories lead the paper; disliked ones are left out, and a super dislike beats any like. Training the same thing again changes its verdict.';

  readonly input = SCHEMA;

  readonly annotations: ToolAnnotations = writes();

  protected override async runParsed(
    args: z.infer<typeof SCHEMA>,
    { uid, db }: ToolContext,
  ): Promise<object> {
    const { input } = checked(parseClassifierInput(args));
    const repo = new Repository(db);
    if (
      input.kind === 'feed' &&
      !(await repo.getFeed(uid, Number(input.value)))
    ) {
      throw new ToolFailureError('value: no such feed.');
    }
    const { classifier, created } = await repo.addClassifier(uid, input);
    return { classifier: classifierResource(classifier), created };
  }
}
