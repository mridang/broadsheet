/**
 * The OAuth-protected MCP endpoint. Assistants connect to this one URL, are
 * sent through the sign-in flow the discovery documents describe, and then
 * call it with `Authorization: Bearer <access token>`.
 *
 * POST /mcp → JSON-RPC 2.0, one message per request.
 *
 * The behaviour lives in `respondToMcp`; this file only supplies the real
 * token check and this site's origin.
 */

import { authenticateMcpRequest } from '@/domain/mcp/auth';
import { respondToMcp } from '@/domain/mcp/http';
import { appOrigin } from '@/lib/core/origin';

export const dynamic = 'force-dynamic';

/** Answer any request to the endpoint with the real token check. */
function respond(request: Request): Promise<Response> {
  return respondToMcp(request, appOrigin(request), authenticateMcpRequest);
}

/**
 * `POST /mcp`: one JSON-RPC message. 200 with the reply, 202 for a
 * notification, 400 for a malformed message, 401 without a valid token, 403
 * when the token lacks the scope, 413 over 1 MiB.
 */
export const POST = respond;

/** `GET /mcp`: no event stream is offered, so 405 for a valid caller. */
export const GET = respond;

/** `DELETE /mcp`: there is no session to end, so 405 for a valid caller. */
export const DELETE = respond;

/** `OPTIONS /mcp`: the CORS preflight. 204. */
export const OPTIONS = respond;
