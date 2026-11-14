/**
 * @packageDocumentation
 *
 * What this app hands its tools, and how it answers the two questions the MCP
 * library asks of every app: which scopes it offers, and which of its own
 * failures are worth explaining to an assistant.
 */

import {
  ReadWriteScopes,
  type FailureExplainer,
  type JsonContent,
} from '@/lib/mcp';
import type { User } from '@/domain/db/users';
import { SCOPE_READ, SCOPE_WRITE, explainFailure } from '@/domain/mcp/app';
import {
  liveToolServices,
  type ToolServices,
} from '@/domain/mcp/tool-services';

/**
 * What every tool in this app is given: who is calling, and the outside things
 * the tools reach for.
 */
export interface ToolContext {
  readonly user: Readonly<User>;
  readonly services: ToolServices;
}

/**
 * The context for a real call.
 * @param user - Who is calling.
 * @param services - What this app's tools reach for; a test passes fakes.
 */
export function toolContext(
  user: Readonly<User>,
  services: ToolServices = liveToolServices,
): ToolContext {
  return { user, services };
}

/**
 * What this app's tools return as structured content. They answer with the
 * facts they read, shaped by what each tool does, so nothing narrower is said
 * here.
 */
export type ToolContent = JsonContent;

/** Which sign-in a call needs, by what the tool says about its own effects. */
export const TOOL_SCOPES = new ReadWriteScopes(SCOPE_READ, SCOPE_WRITE);

/** How this app words what an assistant is told about a failure. */
export const TOOL_FAILURES: FailureExplainer = { explain: explainFailure };
