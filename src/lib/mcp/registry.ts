/**
 * @packageDocumentation
 *
 * The set of tools a server offers.
 *
 * A registry is the one place that knows the whole set. It is built from a
 * tuple of tools so that the union of their names survives as a type, and it
 * refuses two tools of the same name when it is built rather than letting one
 * quietly shadow the other.
 */

import type { JsonContent } from './results';
import type { AnyMcpTool, McpTool } from './tool';

/** The name of one of the tools in a tuple of them. */
export type NameOf<TTools extends readonly AnyMcpTool[]> =
  TTools[number]['name'];

/**
 * Every tool a server offers, looked up by the name an assistant calls.
 *
 * Lookup goes through the tools themselves rather than an object keyed by name,
 * so a call naming an inherited property such as `constructor` finds nothing.
 */
export class ToolRegistry<
  TName extends string,
  TContext,
  TContent = JsonContent,
> {
  readonly #byName: ReadonlyMap<string, McpTool<TName, TContext, TContent>>;

  /**
   * @param tools - Every tool, in the order a catalogue should list them.
   * @throws {Error} If two tools share a name, which would make one of them
   *   unreachable.
   */
  constructor(tools: readonly McpTool<TName, TContext, TContent>[]) {
    const byName = new Map<string, McpTool<TName, TContext, TContent>>();
    for (const tool of tools) {
      if (byName.has(tool.name)) {
        throw new Error(`Two tools are called ${tool.name}.`);
      }
      byName.set(tool.name, tool);
    }
    this.#byName = byName;
  }

  /** Every tool, in the order it was registered. */
  get all(): readonly McpTool<TName, TContext, TContent>[] {
    return [...this.#byName.values()];
  }

  /** The name of every tool, in the order it was registered. */
  get names(): readonly TName[] {
    return this.all.map((tool) => tool.name);
  }

  /**
   * The tool with this name.
   * @param name - The name an assistant called, which is untrusted.
   * @returns The tool, or undefined when no tool has that name.
   */
  named(name: string): McpTool<TName, TContext, TContent> | undefined {
    return this.#byName.get(name);
  }

  /**
   * Whether a name belongs to one of the tools.
   * @param name - The name an assistant called, which is untrusted.
   */
  has(name: string): name is TName {
    return this.#byName.has(name);
  }
}
