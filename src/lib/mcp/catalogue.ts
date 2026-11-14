/**
 * @packageDocumentation
 *
 * The catalogue a server advertises in `tools/list`.
 *
 * A catalogue holds no facts about any tool. It dresses the tools in a
 * {@link ToolRegistry} for the wire, adding only what is the same for every one
 * of them and what nothing but the catalogue cares about: the title in both of
 * the places hosts read it, and the sign-in a call needs.
 */

import type { JsonSchema } from './json-schema';
import type { ToolRegistry } from './registry';
import type { ScopePolicy } from './scopes';
import type { ToolAnnotations } from './tool';

/** The sign-in a call needs, as a host reads it. */
export interface SecurityScheme {
  readonly type: 'oauth2';
  readonly scopes: readonly string[];
}

/** The hints of an advertised tool, which carry its title as well. */
export interface AdvertisedAnnotations extends ToolAnnotations {
  readonly title: string;
}

/** One entry of `tools/list`. */
export interface AdvertisedTool {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
  readonly outputSchema?: JsonSchema;
  readonly annotations: AdvertisedAnnotations;
  readonly securitySchemes: readonly SecurityScheme[];
  readonly _meta: Readonly<Record<string, unknown>>;
}

/**
 * The advertised form of every tool a server offers.
 *
 * The entries are built once, when the catalogue is constructed, because they
 * are the same for every request and are read on every `tools/list`.
 */
export class ToolCatalogue {
  readonly #entries: readonly AdvertisedTool[];

  /**
   * @param registry - The tools to advertise.
   * @param scopes - Which sign-in each call needs.
   */
  constructor(
    registry: ToolRegistry<string, never, unknown>,
    scopes: ScopePolicy,
  ) {
    this.#entries = registry.all.map((tool) => {
      const securitySchemes: readonly SecurityScheme[] = [
        { type: 'oauth2', scopes: [scopes.scopeFor(tool)] },
      ];
      return {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        ...(tool.outputSchema === undefined
          ? {}
          : { outputSchema: tool.outputSchema }),
        title: tool.title,
        annotations: { title: tool.title, ...tool.annotations },
        securitySchemes,
        _meta: { ...tool.meta, securitySchemes },
      };
    });
  }

  /** Every entry of `tools/list`, in the order the registry holds them. */
  get tools(): readonly AdvertisedTool[] {
    return this.#entries;
  }

  /**
   * The advertised entry with this name.
   * @param name - The name an assistant called, which is untrusted.
   * @returns The entry, or undefined when no tool has that name.
   */
  named(name: string): AdvertisedTool | undefined {
    return this.#entries.find((entry) => entry.name === name);
  }
}
