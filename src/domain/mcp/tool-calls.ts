/**
 * @packageDocumentation
 *
 * Running a `tools/call` for this app: the library's invoker, given this app's
 * tools, its failure explainer and somewhere to record a backend failure.
 */

import { ToolInvoker, type ToolArgs, type ToolResult } from '@/lib/mcp';
import type { User } from '@/domain/db/users';
import {
  TOOL_FAILURES,
  toolContext,
  type ToolContent,
  type ToolContext,
} from '@/domain/mcp/tool-context';
import { TOOL_REGISTRY, type ToolName } from '@/domain/mcp/tools';
import type { ToolServices } from '@/domain/mcp/tool-services';
import { errorMessage, logError } from '@/utils/logging';

/**
 * Where a backend failure is recorded. What actually failed stays in our logs,
 * because it can hold details of other services that must not travel on to an
 * assistant.
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

const INVOKER = new ToolInvoker<ToolName, ToolContext, ToolContent>({
  registry: TOOL_REGISTRY,
  failures: TOOL_FAILURES,
  log: FAILURE_LOG,
});

/**
 * Execute a `tools/call` for `user`.
 * @param user - Who is calling.
 * @param params - The `params` of the request, untrusted.
 * @param services - What this app's tools reach for; a test passes fakes.
 */
export async function callTool(
  user: Readonly<User>,
  params: ToolArgs | undefined,
  services?: ToolServices,
): Promise<ToolResult<ToolContent>> {
  return INVOKER.invoke(params, toolContext(user, services));
}

/**
 * Execute a `tools/call`, answering the failures an assistant can act on as
 * results it can relay. An unknown tool or a malformed request is still thrown,
 * for the router to answer as a protocol error.
 * @param user - Who is calling.
 * @param params - The `params` of the request, untrusted.
 * @param services - What this app's tools reach for; a test passes fakes.
 */
export async function callToolOrExplain(
  user: Readonly<User>,
  params: ToolArgs | undefined,
  services?: ToolServices,
): Promise<ToolResult<ToolContent>> {
  return INVOKER.invokeOrExplain(params, toolContext(user, services));
}
