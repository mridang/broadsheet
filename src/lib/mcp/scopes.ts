/**
 * @packageDocumentation
 *
 * Which sign-in a tool call needs.
 *
 * The library does not know an app's scope names, so it asks the app through a
 * {@link ScopePolicy}. {@link ReadWriteScopes} is the policy almost every app
 * wants: one scope that only reads and one that also changes things, chosen by
 * what the tool says about its own effects rather than by a list of names kept
 * somewhere else.
 */

import type { AnyMcpTool, ToolAnnotations } from './tool';

/** Which scope a call needs, as the app names its scopes. */
export interface ScopePolicy {
  /**
   * The scope a call to this tool needs.
   * @param tool - The tool being advertised or called.
   */
  scopeFor(tool: AnyMcpTool): string;
}

/**
 * The two-scope policy: a tool that only reads needs the read scope, and
 * anything else needs the write scope.
 *
 * Because the answer comes from {@link ToolAnnotations.readOnlyHint}, the scope
 * a tool needs and the effects it advertises cannot disagree. A tool that
 * forgets to say it writes is not quietly given the read scope: it has to
 * declare its effects to compile at all.
 */
export class ReadWriteScopes implements ScopePolicy {
  readonly #read: string;
  readonly #write: string;

  /**
   * @param read - The scope that may only read.
   * @param write - The scope that may also change things.
   */
  constructor(read: string, write: string) {
    this.#read = read;
    this.#write = write;
  }

  /** The read scope for a read-only tool, else the write scope. */
  scopeFor(tool: AnyMcpTool): string {
    return tool.annotations.readOnlyHint ? this.#read : this.#write;
  }
}
