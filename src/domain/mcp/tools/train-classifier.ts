/**
 * @packageDocumentation
 *
 * `train_classifier`. Everything the tool is lives here: what the catalogue says about
 * it, the arguments it accepts, and what it does when called.
 */

import {
  classifierResource,
  parseClassifierInput,
} from '@/domain/api/classifier-resource';
import { ToolFailureError } from '@/domain/mcp/tool-failure';
import { type ToolContext } from '@/domain/mcp/tool-context';
import { JsonTool } from '@/domain/mcp/tools/json-tool';
import { checked, id, TRAINABLE } from '@/domain/mcp/tools/support';
import { Repository } from '@/domain/repository';
import { type ToolAnnotations, writes } from '@/lib/mcp';
import { z } from 'zod';

/** What `train_classifier` accepts. */
const SCHEMA = z.object({
  feed_id: id('feed'),
  ...Object.fromEntries(
    TRAINABLE.flatMap((kind) => {
      const label =
        kind === 'text'
          ? 'Phrases in the text'
          : `${kind[0]!.toUpperCase()}${kind.slice(1)}s`;
      return (['like', 'dislike', 'super_dislike'] as const).map((score) => [
        `${score}_${kind}`,
        z
          .array(z.string())
          .max(20)
          .optional()
          .describe(`${label} to ${score.replace('_', '-')}.`),
      ]);
    }),
  ),
  like_feed: z.boolean().optional().describe('Like every story of the feed.'),
  dislike_feed: z
    .boolean()
    .optional()
    .describe('Dislike every story of the feed.'),
});

export class TrainClassifierTool extends JsonTool<
  'train_classifier',
  typeof SCHEMA
> {
  readonly name = 'train_classifier';

  readonly title = 'Train on a feed';

  readonly description =
    'Train many classifiers at once for one feed: titles, authors, tags and text phrases to like, dislike or super-dislike (a super-dislike hides a story even when something else likes it), and the whole feed itself.';

  readonly input = SCHEMA;

  readonly annotations: ToolAnnotations = writes();

  protected override async runParsed(
    args: z.infer<typeof SCHEMA>,
    { user, services }: ToolContext,
  ): Promise<object> {
    const uid = user.id;
    const db = services.openDatabase();
    const input = args as Record<string, unknown> & { feed_id: number };
    const repo = new Repository(db);
    const feed = await repo.getFeed(uid, input.feed_id);
    if (!feed) throw new ToolFailureError('There is no such feed.');
    if (input['like_feed'] && input['dislike_feed']) {
      throw new ToolFailureError('Like or dislike the feed, not both.');
    }
    const wanted = [
      ...TRAINABLE.flatMap((kind) =>
        (['like', 'dislike', 'super_dislike'] as const).flatMap((score) =>
          ((input[`${score}_${kind}`] as string[] | undefined) ?? []).map(
            (value) => ({ kind, value, score }),
          ),
        ),
      ),
      ...(input['like_feed'] || input['dislike_feed']
        ? [
            {
              kind: 'feed',
              value: String(feed.id),
              score: input['like_feed'] ? 'like' : 'dislike',
            },
          ]
        : []),
    ];
    if (wanted.length === 0)
      throw new ToolFailureError('Send something to train.');
    const inputs = wanted.map((w) => checked(parseClassifierInput(w)).input);
    const trained = [];
    for (const one of inputs) {
      const added = await repo.addClassifier(uid, one);
      trained.push(added.classifier);
    }
    return { classifiers: trained.map((c) => classifierResource(c)) };
  }
}
