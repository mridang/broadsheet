/**
 * @packageDocumentation
 *
 * The base of this app's tools, which answer with the facts they read.
 *
 * Every tool here returns data rather than a result: the text an assistant sees
 * and the structured content a host reads are both built from those facts, so
 * every tool answers in the same shape and none of them repeats the wrapping. A
 * tool that cannot do what was asked raises a {@link ToolFailureError}, which
 * becomes a refusal the assistant can act on rather than a protocol error.
 */

import { ToolFailureError } from '@/domain/mcp/tool-failure';
import { checked } from '@/domain/mcp/tools/support';
import { McpTool, dataResult, errorResult } from '@/lib/mcp';
import type { JsonContent, ToolResult } from '@/lib/mcp';
import type { ToolContext } from '@/domain/mcp/tool-context';
import type { z } from 'zod';

/** A tool that answers with the facts it read. */
export abstract class JsonTool<
  TName extends string,
  TInput extends z.ZodObject = z.ZodObject,
> extends McpTool<TName, ToolContext, JsonContent, TInput> {
  /** Run the call and shape what it answered. */
  override async handle(
    args: z.infer<TInput>,
    context: ToolContext,
  ): Promise<ToolResult> {
    try {
      const data = await this.runParsed(args, context);
      return dataResult(JSON.stringify(data), data as JsonContent);
    } catch (error) {
      if (error instanceof ToolFailureError) {
        return errorResult(error.message);
      }
      throw error;
    }
  }

  /**
   * Run the call and answer with the facts it read.
   * @param input - The checked arguments, their defaults filled in.
   * @param context - What the app hands its tools.
   * @throws {ToolFailureError} When the tool cannot do what was asked, in words
   *   the assistant can act on.
   */
  protected abstract runParsed(
    input: z.infer<TInput>,
    context: ToolContext,
  ): Promise<object>;
}
