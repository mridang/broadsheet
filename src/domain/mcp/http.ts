/**
 * @packageDocumentation
 *
 * The MCP endpoint over HTTP (the Streamable HTTP transport, without streams
 * or sessions): one JSON-RPC message per POST, one JSON reply. A request with
 * no valid bearer token gets a 401 whose `WWW-Authenticate` points at the
 * discovery documents; a tool that changes things needs the `write` scope.
 */

import { readBodyText } from '@/lib/core/api';
import {
  ERROR_INVALID_REQUEST,
  ERROR_PARSE,
  McpServer,
  errorReply,
  isJsonRpcMessage,
} from '@/lib/mcp';
import {
  CORS_HEADERS,
  SCOPE_READ,
  SCOPE_WRITE,
  hasScope,
  preflight,
  wwwAuthenticate,
} from '@/lib/oauth';
import { getDatabase } from '@/domain/db/database';
import { getEnv, runInBackground } from '@/lib/core/runtime';
import type { McpAuth } from './auth';
import { INSTRUCTIONS, SERVER_INFO } from './app';
import { PROMPTS } from './prompts';
import { RESOURCES } from './resources';
import { refresher } from './tools/support';
import { TOOL_CATALOGUE, TOOL_INVOKER } from './tool-catalogue';
import type { ToolContext } from './tool-context';
import { answerModel } from '@/domain/api/answers';

/** The largest message accepted, in bytes. */
export const MAX_MCP_BYTES = 1024 * 1024;

/** The server, with every tool. */
export const mcpServer = new McpServer<ToolContext>(
  SERVER_INFO,
  INSTRUCTIONS,
  TOOL_CATALOGUE,
  TOOL_INVOKER,
  RESOURCES,
  PROMPTS,
);

/** The context the tools run in, for a caller. */
export type ContextFor = (uid: number) => ToolContext;

/** The production context: the request's database and background work. */
const liveContext: ContextFor = (uid) => {
  const db = getDatabase();
  const model = answerModel();
  return {
    uid,
    db,
    refresh: refresher(db, getEnv(), runInBackground),
    ...(model ? { model } : {}),
  };
};

/** A JSON reply with the CORS headers. */
function json(body: unknown, status = 200, extra = {}): Response {
  return Response.json(body, {
    status,
    headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store', ...extra },
  });
}

/** A refusal carrying the bearer challenge. */
function challenge(
  origin: string,
  status: 401 | 403,
  error?: string,
  scope?: string,
): Response {
  return new Response(null, {
    status,
    headers: {
      ...CORS_HEADERS,
      'WWW-Authenticate': wwwAuthenticate(origin, {
        ...(error ? { error } : {}),
        ...(scope ? { scope } : {}),
      }),
    },
  });
}

/**
 * Answer a request to `/mcp`. `authenticate` resolves the bearer token;
 * `contextFor` builds what the tools run with (injected by tests).
 */
export async function respondToMcp(
  request: Request,
  origin: string,
  authenticate: (request: Request, origin: string) => Promise<McpAuth>,
  contextFor: ContextFor = liveContext,
): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return preflight();
  }
  const auth = await authenticate(request, origin);
  if (auth.kind === 'no-token') {
    return challenge(origin, 401);
  }
  if (auth.kind === 'invalid-token') {
    return challenge(origin, 401, 'invalid_token');
  }
  if (request.method !== 'POST') {
    return new Response(null, {
      status: 405,
      headers: { ...CORS_HEADERS, Allow: 'POST, OPTIONS' },
    });
  }
  const body = await readBodyText(request, MAX_MCP_BYTES);
  if (body.kind === 'too-large') {
    return json(errorReply(null, ERROR_INVALID_REQUEST, 'Too large.'), 413);
  }
  let message: unknown;
  try {
    message = body.kind === 'ok' ? JSON.parse(body.text) : undefined;
  } catch {
    return json(errorReply(null, ERROR_PARSE, 'Parse error'), 400);
  }
  if (!isJsonRpcMessage(message)) {
    return json(
      errorReply(null, ERROR_INVALID_REQUEST, 'Invalid Request'),
      400,
    );
  }
  if (!hasScope(auth.scope, SCOPE_READ)) {
    return challenge(origin, 403, 'insufficient_scope', SCOPE_READ);
  }
  if (message.method === 'tools/call') {
    const params = message.params as Record<string, unknown> | undefined;
    const found = mcpServer.tool(params?.['name']);
    if (
      found &&
      !found.annotations.readOnlyHint &&
      !hasScope(auth.scope, SCOPE_WRITE)
    ) {
      return challenge(origin, 403, 'insufficient_scope', SCOPE_WRITE);
    }
  }
  const reply = await mcpServer.handleMessage(message, contextFor(auth.uid));
  return reply
    ? json(reply)
    : new Response(null, { status: 202, headers: CORS_HEADERS });
}
