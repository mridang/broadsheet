/**
 * @packageDocumentation
 *
 * `ask_archive`. Everything the tool is lives here: what the catalogue says about
 * it, the arguments it accepts, and what it does when called.
 */

import { messageResource } from '@/domain/api/conversation-resource';
import { budget } from '@/domain/api/usage';
import {
  AnswerUnavailableError,
  MAX_QUESTION_LENGTH,
} from '@/domain/assistant';
import { answerTurn } from '@/domain/assistant-tools';
import { type ToolContext } from '@/domain/mcp/tool-context';
import { id } from '@/domain/mcp/tools/support';
import { ZodTool } from '@/domain/mcp/tools/zod-tool';
import { Repository } from '@/domain/repository';
import { type ToolAnnotations, writes } from '@/lib/mcp';
import { ToolFailureError } from '@/lib/mcp/server';
import { z } from 'zod';

/** What `ask_archive` accepts. */
const SCHEMA = z.object({
  question: z.string().max(MAX_QUESTION_LENGTH).describe('The question.'),
  conversation_id: id('conversation')
    .optional()
    .describe('Continue this conversation; leave out to start one.'),
});

export class AskArchiveTool extends ZodTool<'ask_archive', typeof SCHEMA> {
  readonly name = 'ask_archive';

  readonly title = 'Ask the archive';

  readonly description =
    "Ask a question answered from the stories in the person's feeds, saves and reads, with the articles it cites. Continue a conversation with its id.";

  readonly input = SCHEMA;

  readonly annotations: ToolAnnotations = writes();

  protected override async runParsed(
    { question, conversation_id }: z.infer<typeof SCHEMA>,
    { uid, db, model }: ToolContext,
  ): Promise<object> {
    const asked = question.trim();
    if (!asked) throw new ToolFailureError('question: must not be blank.');
    const repo = new Repository(db);
    const conversation =
      conversation_id === undefined
        ? await repo.addConversation(uid)
        : await repo.getConversation(uid, conversation_id);
    if (!conversation)
      throw new ToolFailureError('There is no such conversation.');
    const quota = await budget(repo, uid, 'assistant');
    if (!quota.remaining) {
      throw new ToolFailureError(
        'You have used all your assistant questions for today. They reset at midnight UTC.',
      );
    }
    let turn: Awaited<ReturnType<typeof answerTurn>>;
    try {
      turn = await answerTurn(repo, uid, conversation.id, asked, model);
    } catch (error) {
      if (error instanceof AnswerUnavailableError) {
        throw new ToolFailureError('The assistant could not answer just now.');
      }
      throw error;
    }
    return {
      conversation_id: String(conversation.id),
      message: messageResource(turn.reply, turn.titles),
    };
  }
}
