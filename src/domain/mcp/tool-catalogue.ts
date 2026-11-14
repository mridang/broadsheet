/**
 * @packageDocumentation
 *
 * The catalogue this server advertises, and the invoker that runs a call,
 * built from this app's tools.
 */

import { ToolCatalogue, ToolInvoker } from '@/lib/mcp';
import { errorMessage, logError } from '@/utils/logging';
import {
  TOOL_FAILURES,
  TOOL_SCOPES,
  type ToolContent,
  type ToolContext,
} from '@/domain/mcp/tool-context';
import { TOOL_REGISTRY, type ToolName } from '@/domain/mcp/tools';

/**
 * Where a failure of a service a tool depends on is recorded. What actually
 * failed stays in our logs, because it can hold details that must not travel on
 * to an assistant.
 */
const FAILURE_LOG = {
  record(service: string, cause: unknown): void {
    logError({
      event: 'mcp.backend_failed',
      service,
      error: errorMessage(cause),
    });
  },
};

/** The advertised form of every tool this server offers. */
export const TOOL_CATALOGUE = new ToolCatalogue(TOOL_REGISTRY, TOOL_SCOPES);

/** Runs a `tools/call` against this app's tools. */
export const TOOL_INVOKER = new ToolInvoker<ToolName, ToolContext, ToolContent>(
  {
    registry: TOOL_REGISTRY,
    failures: TOOL_FAILURES,
    log: FAILURE_LOG,
  },
);
