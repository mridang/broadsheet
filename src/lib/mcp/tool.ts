/**
 * @packageDocumentation
 *
 * What an MCP tool is, and the effect hints and argument spellings it declares
 * about itself.
 *
 * A tool is one class. It carries the name an assistant calls, what the
 * catalogue says about it, the schema its arguments are checked against, the
 * looser spellings it forgives, and the code that runs. Nothing about a tool
 * lives in a table beside it, so a tool that forgets any part of itself does
 * not compile and a tool advertised without an implementation cannot be
 * written down.
 *
 * {@link McpTool} is generic over the context its tools are given, which is
 * whatever an app's tools need: a database, a user, an access token. It is
 * generic over the structured content they return as well, so an app that draws
 * its results in a view can give that content its own type. The library never
 * names any of them, so it carries no knowledge of the app it serves.
 */

import { z } from 'zod';

import type { JsonSchema } from './json-schema';
import type { JsonContent, ToolResult } from './results';

/** The arguments of a tool call, before they are checked against the schema. */
export type ToolArgs = Readonly<Record<string, unknown>>;

/**
 * What a tool tells hosts about its effects, as the MCP specification's
 * `ToolAnnotations`. Hosts use these to decide when to ask the person before a
 * call, so each is set from what the tool's code really does rather than from
 * what its name suggests.
 */
export interface ToolAnnotations {
  /** Whether the tool only reads, so a read-only grant may call it. */
  readonly readOnlyHint: boolean;
  /** Whether it may remove or overwrite something the person cannot get back. */
  readonly destructiveHint: boolean;
  /** Whether calling it twice with the same arguments leaves the same state as once. */
  readonly idempotentHint: boolean;
  /** Whether it reaches the open web rather than only the app's own records. */
  readonly openWorldHint: boolean;
}

/** What a writing tool may do, for {@link writes}. */
export interface WriteEffects {
  /** It may remove or overwrite something the person cannot get back. */
  readonly destructive?: boolean;
  /** Calling it twice with the same arguments leaves the same state as once. */
  readonly idempotent?: boolean;
  /** It reaches the open web. */
  readonly openWorld?: boolean;
}

/**
 * The hints of a tool that only reads the app's own records, which are a closed
 * world.
 */
export const READS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

/** The hints of a tool that only reads, but reads the open web as well. */
export const READS_THE_WEB: ToolAnnotations = {
  ...READS,
  openWorldHint: true,
};

/**
 * The hints of a tool that changes something. Every effect defaults to false,
 * which describes a tool that adds something new to the app's own records.
 * @param effects - What this particular tool may do.
 * @returns The four hints, with `readOnlyHint` false.
 */
export function writes(effects: WriteEffects = {}): ToolAnnotations {
  return {
    readOnlyHint: false,
    destructiveHint: effects.destructive === true,
    idempotentHint: effects.idempotent === true,
    openWorldHint: effects.openWorld === true,
  };
}

/**
 * The looser spellings of its arguments a tool forgives.
 *
 * A catalogue lists only canonical names, so a model sees one way to say each
 * thing and the input schema can stay closed. A connector that cached an
 * earlier catalogue, or a model carrying an argument over from a similar tool,
 * is corrected rather than refused.
 */
export interface ArgumentSpellings {
  /** Looser names, and the canonical name each one stands for. */
  readonly aliases?: Readonly<Record<string, string>>;
  /**
   * Arguments declared as a list of text that a model may send as one piece of
   * text. Such a value is wrapped into a one-item list before it is checked.
   */
  readonly listsOfText?: readonly string[];
}

/**
 * One tool: what it is called, what it says about itself, and what it does.
 *
 * `TName` is the tool's own name as a literal type, so the union of every
 * registered name can be read back off a {@link ToolRegistry} and a misspelled
 * name is a compile error rather than a call that finds no tool. `TContext` is
 * whatever the app hands its tools, and `TContent` the shape of the structured
 * content they return.
 */
export abstract class McpTool<
  TName extends string = string,
  TContext = unknown,
  TContent = JsonContent,
  TInput extends z.ZodObject = z.ZodObject,
> {
  /** The name an assistant calls, in `snake_case`. */
  abstract readonly name: TName;

  /** The name shown in a host's interface. */
  abstract readonly title: string;

  /**
   * What the tool does and returns. Advice on which tool to reach for belongs
   * in the server's instructions rather than here.
   */
  abstract readonly description: string;

  /**
   * The arguments the tool accepts, and the only description of them.
   *
   * zod rather than JSON Schema because zod says things JSON Schema cannot: a
   * default to fill in when an argument is absent, and a check no keyword
   * covers, such as a date that parses but is not a day in the calendar. This
   * is a promise rather than documentation: every call is measured against it
   * before anything runs.
   */
  abstract readonly input: TInput;

  /**
   * The arguments the catalogue advertises, derived from {@link input}. Hosts
   * and models read this; a call is measured against the zod schema it came
   * from, so a default or a check that JSON Schema cannot carry still applies.
   *
   * The `$schema` key zod adds is left out: it names the dialect, which the
   * MCP specification already fixes, and the argument checker treats a keyword
   * it does not act on as one to warn about.
   */
  get inputSchema(): JsonSchema {
    const schema = z.toJSONSchema(this.input, { io: 'input' }) as Record<
      string,
      unknown
    >;
    delete schema['$schema'];
    return schema as JsonSchema;
  }

  /** The shape of the structured content this tool returns, where it has one. */
  readonly outputSchema?: JsonSchema;

  /** What the tool tells hosts about its effects. */
  abstract readonly annotations: ToolAnnotations;

  /**
   * Anything this tool adds to its catalogue entry's `_meta`, such as the view
   * a host should draw its result in. What every tool carries, such as the
   * sign-in a call needs, is added by the catalogue instead.
   */
  readonly meta?: Readonly<Record<string, unknown>>;

  /** The looser spellings of its arguments this tool forgives. */
  readonly spellings?: ArgumentSpellings;

  /**
   * The one outside service this tool's work depends on, named as an assistant
   * should hear it ("the database"). When it is set, anything {@link handle}
   * throws that is not already a failure of a named service becomes a
   * {@link BackendFailureError} for that one, so a tool whose every step talks
   * to the same place need not wrap each of them.
   *
   * Leave it unset for a tool that reaches more than one service, or that
   * should let a mistake in its own code escape loudly; such a tool names the
   * service at the call it is guarding instead.
   */
  readonly backend?: string;

  /**
   * A limit on the call itself, checked once the arguments fit and before
   * anything is opened, so that a refusal costs nothing but the check.
   *
   * Checks on the arguments belong in {@link inputSchema}, and anything needing
   * the person's own data belongs in {@link handle}.
   * @param _context - What the app hands its tools.
   * @returns The refusal to answer with, or undefined to carry on.
   */
  async precheck(
    _context: TContext,
  ): Promise<ToolResult<TContent> | undefined> {
    return undefined;
  }

  /**
   * Run the call. The arguments have already been corrected for
   * {@link spellings} and parsed by {@link input}, so their defaults are filled
   * in and this does not check them again.
   *
   * Anything slow or costly is opened through the context when the tool asks
   * for it, never in advance, so a tool that does not need it does not pay for
   * it. Problems the assistant can act on are raised as errors the app's
   * failure explainer recognises; only a mistake in this code escapes as an
   * exception.
   * @param args - The checked arguments of the call.
   * @param context - What the app hands its tools.
   */
  abstract handle(
    args: z.infer<TInput>,
    context: TContext,
  ): Promise<ToolResult<TContent>>;
}

/**
 * Any tool at all, whatever context it is given and whatever structured content
 * it returns.
 *
 * The context is `never` and the content `unknown` so that every tool is
 * assignable: a function taking a particular context stands in for one taking
 * none, and a result carrying a particular shape stands in for one carrying
 * anything. This is the type to ask for when a collaborator reads what a tool
 * says about itself and never calls it, as a catalogue or a scope policy does.
 */
export type AnyMcpTool = McpTool<string, never, unknown, z.ZodObject>;
