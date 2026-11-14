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
import type { AnswerModel } from '@/domain/assistant';
import type { Database } from '@/domain/db/database';
import { SCOPE_READ, SCOPE_WRITE } from '@/lib/oauth/scopes';

/** Who is calling and what the tools reach out to. */
export interface ToolContext {
  readonly uid: number;
  readonly db: Database;
  /** Fetch a newly followed feed after the reply is sent. */
  readonly refresh: (source: {
    readonly id: number;
    readonly url: string;
  }) => void;
  /** The model that answers archive questions, when one is bound. */
  readonly model?: AnswerModel;
}

/**
 * What this app's tools return as structured content. They answer with plain
 * objects shaped by what each tool reads, so nothing narrower is said here.
 */
export type ToolContent = JsonContent;

/** Which sign-in a call needs, by what the tool says about its own effects. */
export const TOOL_SCOPES = new ReadWriteScopes(SCOPE_READ, SCOPE_WRITE);

/**
 * A tool that cannot do what was asked says so itself, as a result the
 * assistant can act on, so there is no failure left here to explain.
 */
export const TOOL_FAILURES: FailureExplainer = { explain: () => undefined };
