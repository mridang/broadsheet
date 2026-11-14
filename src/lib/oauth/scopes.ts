/**
 * @packageDocumentation
 *
 * The scopes an assistant can hold on a user's data, and which MCP calls need
 * which. Two scopes keep consent simple and let a connector be read-only: one
 * that only reads and one that also changes things. Write implies read. Their
 * names, and which tools only read, are this app's own (`domain/mcp/app.ts`).
 */

import { SCOPE_READ, SCOPE_WRITE, SUPPORTED_SCOPES } from '@/domain/mcp/app';
import { TOOL_SCOPES } from '@/domain/mcp/tool-context';
import { TOOL_REGISTRY } from '@/domain/mcp/tools';

/**
 * The OpenID Connect scope that asks for a refresh token. Every grant here gets
 * one anyway, so the scope changes nothing; it is advertised in the
 * authorization server's metadata so clients that follow the MCP refresh-token
 * guidance can send it, and it is accepted and ignored. It is deliberately NOT
 * in {@link SUPPORTED_SCOPES} (the MCP server must not ask for it in its
 * `WWW-Authenticate` challenge or resource metadata) and never appears in a grant.
 */
export const SCOPE_OFFLINE_ACCESS = 'offline_access';

/** One of the two scopes, whether or not this app offers it. */
export type Scope = typeof SCOPE_READ | typeof SCOPE_WRITE;

/** Whether a string names a scope this app offers. */
export function isSupportedScope(scope: string): scope is Scope {
  return (SUPPORTED_SCOPES as readonly string[]).includes(scope);
}

/**
 * Turn a request's space-separated `scope` into the scopes to grant. No scope
 * asked for means everything we support; asking only for scopes we don't know
 * yields an empty list, which the caller reports as `invalid_scope`. Unknown
 * scopes mixed with known ones are dropped rather than failing the request.
 * {@link SCOPE_OFFLINE_ACCESS} Is ignored, so asking for it alone is the same as
 * asking for nothing.
 */
export function normaliseScope(
  requested: string | undefined | null,
): readonly Scope[] {
  const asked = (requested ?? '')
    .split(/\s+/)
    .filter((scope) => scope !== '' && scope !== SCOPE_OFFLINE_ACCESS);
  if (asked.length === 0) {
    return [...SUPPORTED_SCOPES];
  }
  return SUPPORTED_SCOPES.filter((s) => asked.includes(s));
}

/** Whether the granted scopes cover `needed` (write covers read). */
export function hasScope(granted: readonly string[], needed: string): boolean {
  if (granted.includes(needed)) {
    return true;
  }
  return needed === SCOPE_READ && granted.includes(SCOPE_WRITE);
}

/**
 * The scope one MCP tool needs, taken from what the tool says about its own
 * effects. A name no tool has needs the write scope, so an unknown call is
 * refused rather than let through on a read-only grant.
 * @param name - The name an assistant called, which is untrusted.
 */
export function scopeForTool(name: string): Scope {
  const tool = TOOL_REGISTRY.named(name);
  return tool === undefined
    ? SCOPE_WRITE
    : (TOOL_SCOPES.scopeFor(tool) as Scope);
}

/** A JSON-RPC message as far as scope checking cares. */
export interface ScopedMessage {
  readonly method?: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

/**
 * The scope a JSON-RPC message needs. Calling a tool needs that tool's scope;
 * every other method (handshake, listing tools, reading UI resources) only
 * needs a valid token, which means at least read.
 * A tool this function does not know counts as a write, so a tool added
 * without being classified is protected; the MCP endpoint (`mcp/http.ts`)
 * checks the name first, so a call to a tool that does not exist is answered
 * "unknown tool" to any valid token instead of reaching this rule.
 */
export function scopeForMessage(message: ScopedMessage): Scope {
  if (message.method === 'tools/call') {
    const name = message.params?.['name'];
    return typeof name === 'string' ? scopeForTool(name) : SCOPE_WRITE;
  }
  return SCOPE_READ;
}

export { SCOPE_READ, SCOPE_WRITE, SUPPORTED_SCOPES } from '@/domain/mcp/app';
