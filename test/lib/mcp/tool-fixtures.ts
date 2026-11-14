/**
 * @packageDocumentation
 *
 * Tools that exist only to exercise the MCP library. They stand in for an app's
 * real ones, so the library can be tested on tool shapes no single app happens
 * to have: one that writes, one that destroys, one that forgives a looser
 * argument name, one that refuses a call before it runs.
 */

import { z } from 'zod';

import {
  McpTool,
  READS,
  READS_THE_WEB,
  dataResult,
  errorResult,
  textResult,
  writes,
  type ArgumentSpellings,
  type JsonSchema,
  type ToolAnnotations,
  type ToolResult,
} from '@/lib/mcp';

/** What the fixture tools are handed. */
export interface FixtureContext {
  /** Whether the call should be refused before it runs. */
  readonly refuse?: boolean;
  /** What a tool records when it runs, so a test can see that it did. */
  readonly ran: string[];
}

/** A context that lets every call through. */
export function fixtureContext(
  overrides: Partial<FixtureContext> = {},
): FixtureContext {
  return { ran: [], ...overrides };
}

/** A read-only tool that takes a bounded limit and returns structured data. */
export class CountTool extends McpTool<'count', FixtureContext> {
  readonly name = 'count';

  readonly title = 'Count things';

  readonly description = 'Counts the things, up to the limit it is given.';

  readonly input = z
    .object({ limit: z.int().min(1).max(10).default(0) })
    .strict();

  override readonly outputSchema: JsonSchema = {
    type: 'object',
    required: ['count'],
    properties: { count: { type: 'integer' } },
  };

  readonly annotations: ToolAnnotations = READS;

  override async handle(
    args: { readonly limit: number },
    context: FixtureContext,
  ): Promise<ToolResult> {
    context.ran.push(this.name);
    return dataResult('Counted.', { count: args.limit });
  }
}

/** A tool that reads the open web, and advertises no structured content. */
export class FetchTool extends McpTool<'fetch', FixtureContext> {
  readonly name = 'fetch';

  readonly title = 'Fetch a page';

  readonly description = 'Reads a page from the open web.';

  readonly input = z.object({ url: z.string().max(200) }).strict();

  readonly annotations: ToolAnnotations = READS_THE_WEB;

  override readonly meta = { 'x-widget': 'page' };

  override async handle(
    _args: object,
    context: FixtureContext,
  ): Promise<ToolResult> {
    context.ran.push(this.name);
    return textResult('Fetched.');
  }
}

/** A tool that changes something, and forgives an older argument name. */
export class RenameTool extends McpTool<'rename', FixtureContext> {
  readonly name = 'rename';

  readonly title = 'Rename a thing';

  readonly description = 'Gives a thing a new name.';

  readonly input = z
    .object({
      thing: z.string().max(100),
      tags: z.array(z.string()).optional(),
    })
    .strict();

  readonly annotations: ToolAnnotations = writes({ idempotent: true });

  override readonly spellings: ArgumentSpellings = {
    aliases: { name: 'thing' },
    listsOfText: ['tags'],
  };

  override async handle(
    args: { readonly thing: string },
    context: FixtureContext,
  ): Promise<ToolResult> {
    context.ran.push(this.name);
    return textResult(`Renamed ${args.thing}.`);
  }
}

/** A tool that destroys something, and that refuses a call when told to. */
export class DeleteTool extends McpTool<'delete', FixtureContext> {
  readonly name = 'delete';

  readonly title = 'Delete a thing';

  readonly description = 'Removes a thing for good.';

  readonly input = z.object({}).strict();

  readonly annotations: ToolAnnotations = writes({
    destructive: true,
    idempotent: true,
  });

  override async precheck(
    context: FixtureContext,
  ): Promise<ToolResult | undefined> {
    return context.refuse === true
      ? errorResult('Not allowed just now.')
      : undefined;
  }

  override async handle(
    _args: object,
    context: FixtureContext,
  ): Promise<ToolResult> {
    context.ran.push(this.name);
    return textResult('Deleted.');
  }
}
