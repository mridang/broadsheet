/**
 * @packageDocumentation
 *
 * The catalogue this server advertises in `tools/list`, built from the tools
 * themselves. Nothing about a tool is written down here.
 */

import { ToolCatalogue } from '@/lib/mcp';
import { TOOL_SCOPES } from '@/domain/mcp/tool-context';
import { TOOL_REGISTRY } from '@/domain/mcp/tools';

export type { ToolName } from '@/domain/mcp/tools';

/** The advertised form of every tool this server offers. */
export const TOOL_CATALOGUE = new ToolCatalogue(TOOL_REGISTRY, TOOL_SCOPES);

/** Every entry of `tools/list`. */
export const TOOLS = TOOL_CATALOGUE.tools;

/**
 * The advertised tool with this name.
 * @param name - The name an assistant called, which is untrusted.
 */
export function toolNamed(name: string) {
  return TOOL_CATALOGUE.named(name);
}
