/**
 * @packageDocumentation
 *
 * The base of this app's tools, which describe their arguments with zod.
 *
 * The MCP library checks a call against a JSON Schema, which is what the wire
 * needs and what every other app writes by hand. This app's tools were written
 * against zod instead, and zod says things JSON Schema cannot: nineteen of them
 * fill in a default when an argument is absent, and one refuses a date that
 * looks right but is not a day in the calendar. Rewriting those as JSON Schema
 * would quietly drop both.
 *
 * So zod stays the one description of what a tool accepts. {@link ZodTool}
 * derives the schema the catalogue advertises from it, and checks each call
 * with zod itself, so defaults are filled in and refinements are enforced
 * exactly as before. A subclass only says what to do with arguments that
 * already fit.
 */

import { type ToolContent, type ToolContext } from '@/domain/mcp/tool-context';
import { checked } from '@/domain/mcp/tools/support';
import {
  dataResult,
  errorResult,
  type JsonSchema,
  McpTool,
  type ToolArgs,
  type ToolResult,
} from '@/lib/mcp';
import { ToolFailureError } from '@/lib/mcp/server';
import { z } from 'zod';

/**
 * A tool whose arguments are described by a zod object.
 *
 * `TName` is the tool's own name as a literal type, and `TInput` its argument
 * schema, so what {@link runParsed} receives is tied to that schema and a
 * mistyped argument is a compile error.
 */
export abstract class ZodTool<
  TName extends string,
  TInput extends z.ZodObject = z.ZodObject,
> extends McpTool<TName, ToolContext, ToolContent> {
  /** What the tool accepts, and the only description of it. */
  abstract readonly input: TInput;

  /**
   * The arguments the catalogue advertises, derived from {@link input}. Hosts
   * and models read this; what a call is actually measured against is the zod
   * schema it came from.
   */
  get inputSchema(): JsonSchema {
    return z.toJSONSchema(this.input, { io: 'input' }) as JsonSchema;
  }

  /**
   * Check the call with zod, run it, and shape what it answered.
   *
   * A tool returns the facts it read and nothing else: the text an assistant
   * sees and the structured content a host reads are both built from them here,
   * so every tool answers in the same shape. A tool that cannot do what was
   * asked raises a {@link ToolFailureError}, which becomes a refusal the
   * assistant can act on rather than a protocol error. Nothing is read for a
   * call whose arguments do not fit.
   */
  override async handle(
    args: ToolArgs,
    context: ToolContext,
  ): Promise<ToolResult<ToolContent>> {
    const parsed = this.input.safeParse(args);
    if (!parsed.success) {
      return errorResult(
        `The arguments are not valid: ${parsed.error.issues
          .map(
            (issue) =>
              `${issue.path.join('.') || 'arguments'}: ${issue.message}`,
          )
          .join('; ')}`,
      );
    }
    try {
      const data = await this.runParsed(
        parsed.data as z.infer<TInput>,
        context,
      );
      return dataResult(JSON.stringify(data), data as ToolContent);
    } catch (error) {
      if (error instanceof ToolFailureError) {
        return errorResult(error.message);
      }
      throw error;
    }
  }

  /**
   * Run the call with arguments that fit, their defaults filled in, and answer
   * with the facts it read.
   * @param input - The checked arguments.
   * @param context - What the app hands its tools.
   * @throws {ToolFailureError} When the tool cannot do what was asked, in words
   *   the assistant can act on.
   */
  protected abstract runParsed(
    input: z.infer<TInput>,
    context: ToolContext,
  ): Promise<object>;
}
