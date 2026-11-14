/**
 * @packageDocumentation
 *
 * The HTTP side of the MCP endpoints: read a JSON-RPC message (or batch), check
 * it is well formed and that the caller's scopes and rate limit cover it, hand
 * it to the MCP server, and write the reply. Used by the OAuth-protected
 * `/mcp`.
 *
 * The order matters. The size cap comes before the JSON is parsed; envelope and
 * header checks come before anything is run; the scope check comes before the
 * rate limit (a refused call costs nothing); and every refusal that can name the
 * request it answers carries that request's id.
 */

import { errorMessage, logError } from '@/utils/logging';
import type { User } from '@/domain/db/users';
import {
  CORS_HEADERS,
  SCOPE_READ,
  hasScope,
  scopeForMessage,
  wwwAuthenticate,
} from '@/lib/oauth';
import type { McpAuth } from '@/domain/mcp/auth';
import { ALLOWED_ORIGINS_SETTING, getEnvSafe } from '@/domain/mcp/env';
import {
  ERROR_INTERNAL,
  ERROR_INVALID_REQUEST,
  ERROR_METHOD_NOT_FOUND,
  ERROR_PARSE,
  checkBatch,
  checkRequestHeaders,
  errorBody,
  headerVersion,
  isAllowedOrigin,
  isModernRequest,
  parseMessage,
  protocolRefusal,
  withoutId,
  MODERN_VERSION,
  replyIdOf,
  type ProtocolMessage,
  type ProtocolRefusal,
} from '@/lib/mcp';
import {
  MAX_BATCH,
  checkRateLimits,
  chargeRefusedBody,
  liveRateLimitDeps,
  readJsonBody,
  type RateLimitDeps,
} from '@/domain/mcp/request-limits';
import {
  handleMcpMessage,
  isAdvertisedTool,
  type JsonRpcResponse,
} from '@/domain/mcp/server';

/**
 * Replies carry a person's own data and are never meant to be stored by a shared
 * cache; the MCP-level `cacheScope` hints tell a client what it may keep.
 */
const NO_STORE: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store',
};

/** The extra browser origins the operator allowed (see {@link ALLOWED_ORIGINS_SETTING}). */
function configuredOrigins(): string | undefined {
  return getEnvSafe(ALLOWED_ORIGINS_SETTING);
}

/**
 * The refusal for a request from an origin we don't allow, or null. Browsers
 * send `Origin` on cross-site requests; an unknown one is turned away with a 403
 * before anything is read. `extraOrigins` is the `MCP_ALLOWED_ORIGINS` setting
 * (read from the environment unless a caller passes it).
 *
 * The refusal carries no CORS headers on purpose: a page from a refused origin
 * gets an opaque network error rather than a body it could read.
 */
export function originRefusal(
  request: Request,
  selfOrigin: string,
  extraOrigins: string | undefined = configuredOrigins(),
): Response | null {
  const origin = request.headers.get('origin');
  if (isAllowedOrigin(origin, selfOrigin, extraOrigins)) {
    return null;
  }
  return Response.json(errorBody(ERROR_INVALID_REQUEST, 'Origin not allowed'), {
    status: 403,
    headers: NO_STORE,
  });
}

/**
 * The 401 that starts the sign-in flow (no token) or reports a bad one
 * (`invalidToken`). Its `WWW-Authenticate` points the assistant at the
 * discovery documents. The status and that header are what tell a client to
 * sign in; the JSON-RPC body is only a courtesy, and it carries no id because
 * the request was never read.
 */
export function unauthorizedResponse(
  origin: string,
  invalidToken: boolean,
  cors: Readonly<Record<string, string>>,
): Response {
  return Response.json(
    errorBody(ERROR_INVALID_REQUEST, 'Authorization required'),
    {
      status: 401,
      headers: {
        ...cors,
        ...NO_STORE,
        'WWW-Authenticate': wwwAuthenticate(
          origin,
          invalidToken ? { error: 'invalid_token' } : {},
        ),
      },
    },
  );
}

/** Header names as a browser lists them in a preflight: tokens separated by commas. */
const REQUESTED_HEADERS = /^[A-Za-z0-9-]+(?:\s*,\s*[A-Za-z0-9-]+)*$/;

/** The longest list of requested headers worth echoing back. */
const MAX_REQUESTED_HEADERS_LENGTH = 512;

/**
 * CORS headers for an endpoint that checks origins: echo the caller's, not "*".
 *
 * A caller whose `Origin` is not allowed gets none at all, so this is safe to
 * use on any reply, not only after an origin check. For an allowed origin a
 * preflight's `Access-Control-Request-Headers` is echoed back (when it looks
 * like a plain list of header names), so a client that sends one header more
 * than the fixed list below (a future `Mcp-Param-*`, `Cache-Control`) is not
 * stopped by an opaque preflight failure. That is safe because the endpoint is
 * authenticated by a bearer token the page must hold, never by cookies.
 */
export function corsFor(
  request: Request,
  selfOrigin: string,
  extraOrigins: string | undefined = configuredOrigins(),
): Readonly<Record<string, string>> {
  const origin = request.headers.get('origin');
  if (origin === null) {
    return CORS_HEADERS;
  }
  if (!isAllowedOrigin(origin, selfOrigin, extraOrigins)) {
    return {};
  }
  const requested = request.headers.get('access-control-request-headers');
  const echoed =
    requested !== null &&
    requested.length <= MAX_REQUESTED_HEADERS_LENGTH &&
    REQUESTED_HEADERS.test(requested)
      ? requested
      : undefined;
  return {
    ...CORS_HEADERS,
    'Access-Control-Allow-Origin': origin,
    ...(echoed === undefined
      ? { Vary: 'Origin' }
      : {
          'Access-Control-Allow-Headers': echoed,
          Vary: 'Origin, Access-Control-Request-Headers',
        }),
  };
}

/** A protocol refusal as an HTTP response. */
function refuse(
  refusal: ProtocolRefusal,
  cors: Readonly<Record<string, string>>,
): Response {
  return Response.json(refusal.body, {
    status: refusal.status,
    headers: { ...cors, ...NO_STORE, ...refusal.headers },
  });
}

/** An empty 202: the answer to notifications, and to replies we have nothing to say to. */
function accepted(cors: Readonly<Record<string, string>>): Response {
  return new Response(null, {
    status: 202,
    headers: { ...cors, ...NO_STORE },
  });
}

/** A 400 for a body that cannot be taken as one message or a batch of them. */
function invalidRequest(message: string): ProtocolRefusal {
  return protocolRefusal({
    status: 400,
    code: ERROR_INVALID_REQUEST,
    message,
  });
}

/**
 * The scope a message needs. A call to a tool we don't have needs only the
 * ability to read, so the caller is told the tool does not exist rather than
 * that they lack a scope for something that isn't there.
 */
function requiredScope(message: ProtocolMessage): string {
  return message.method === 'tools/call' &&
    !isAdvertisedTool(message.params?.['name'])
    ? SCOPE_READ
    : scopeForMessage(message);
}

/** The refusal for a message the token's scopes don't cover, or null if all are covered. */
function scopeRefusal(
  messages: readonly ProtocolMessage[],
  scopes: readonly string[],
  origin: string,
): ProtocolRefusal | null {
  const denied = messages
    .map((message) => ({ message, needed: requiredScope(message) }))
    .find(({ needed }) => !hasScope(scopes, needed));
  return denied
    ? protocolRefusal({
        status: 403,
        code: ERROR_INVALID_REQUEST,
        message: `Requires the ${denied.needed} scope`,
        id: replyIdOf(denied.message.id),
        headers: {
          'WWW-Authenticate': wwwAuthenticate(origin, {
            error: 'insufficient_scope',
            scope: denied.needed,
          }),
        },
      })
    : null;
}

/** Whether a reply is the "no such method" error. */
function isUnknownMethod(reply: JsonRpcResponse): boolean {
  return 'error' in reply && reply.error.code === ERROR_METHOD_NOT_FOUND;
}

/**
 * Handle one POST of JSON-RPC. `scopes` is what the caller was granted; `rate`
 * says where the per-user rate-limit counters live (the real database unless a
 * test passes its own).
 *
 * Answers 200 with the reply (404 for an unknown method in the newest
 * revision), 202 for notifications and for replies a client sent us, 400 for a
 * malformed message or mismatched headers, 403 for a missing scope, 413 for an
 * oversized body and 429 (with `Retry-After`) for a caller over their limit.
 * Every reply says `Cache-Control: no-store`.
 *
 * A body that cannot be read as messages at all (too large, not JSON, not a
 * message, a batch of the wrong size) is refused without running anything, but
 * it still counts once against the caller's general allowance: reading and
 * parsing it was not free, and a token holder must not be able to send junk
 * without end. Well-formed requests refused for their headers or scope cost
 * nothing, so a client that is merely misconfigured is not punished twice.
 */
export async function handleMcpPost(
  request: Request,
  user: Readonly<User>,
  scopes: readonly string[],
  origin: string,
  rate: RateLimitDeps = liveRateLimitDeps(),
): Promise<Response> {
  const cors = corsFor(request, origin);
  // Refuse a body we could not read as messages, unless the junk has already
  // used up the caller's allowance, in which case say so instead.
  const unreadable = async (refusal: ProtocolRefusal) =>
    refuse((await chargeRefusedBody(user, rate)) ?? refusal, cors);
  const body = await readJsonBody(request);
  if (body.kind === 'too-large') {
    return unreadable(
      protocolRefusal({
        status: 413,
        code: ERROR_INVALID_REQUEST,
        message: 'Request body too large.',
      }),
    );
  }
  if (body.kind === 'unparseable') {
    return unreadable(
      protocolRefusal({
        status: 400,
        code: ERROR_PARSE,
        message: 'Parse error',
      }),
    );
  }

  const isBatch = Array.isArray(body.value);
  const items: readonly unknown[] = Array.isArray(body.value)
    ? body.value
    : [body.value];
  // A batch must be a sensible size (its messages run side by side).
  if (items.length === 0 || items.length > MAX_BATCH) {
    return unreadable(invalidRequest('Invalid Request'));
  }
  const parsed = items.map((item) => parseMessage(item));
  const invalid = parsed.find((p) => p.kind === 'invalid');
  if (invalid) {
    return unreadable(isBatch ? withoutId(invalid.refusal) : invalid.refusal);
  }
  // Replies to things a server asked are not ours to answer (we ask nothing).
  const messages = parsed.flatMap((p) => ('message' in p ? [p.message] : []));
  if (messages.length === 0) {
    return headerVersion(request.headers) === MODERN_VERSION
      ? refuse(
          invalidRequest(
            `Protocol ${MODERN_VERSION} clients must not send replies.`,
          ),
          cors,
        )
      : accepted(cors);
  }

  const batchRefusal = isBatch ? checkBatch(request.headers, messages) : null;
  const refusal =
    batchRefusal ??
    messages
      .map((message) => checkRequestHeaders(request.headers, message))
      .find((found) => found !== null) ??
    scopeRefusal(messages, scopes, origin) ??
    (await checkRateLimits(user, messages, rate));
  if (refusal) {
    return refuse(isBatch ? withoutId(refusal) : refusal, cors);
  }

  const replies = await Promise.all(
    messages.map((m) => handleMcpMessage(user, m)),
  );
  const headers = { ...cors, ...NO_STORE };
  if (isBatch) {
    const answered = replies.filter((r) => r !== null);
    return answered.length > 0
      ? Response.json(answered, { headers })
      : accepted(cors);
  }
  const [reply] = replies;
  const [message] = messages;
  if (!reply) {
    return accepted(cors);
  }
  // The newest revision wants an unknown method as a 404, not a plain 200.
  const status =
    message !== undefined && isModernRequest(message) && isUnknownMethod(reply)
      ? 404
      : 200;
  return Response.json(reply, { status, headers });
}

/**
 * How a request is checked for a bearer token: the real one looks the token up
 * (see `authenticateMcpRequest`), the conformance harness answers with a fixed
 * user.
 */
export type Authenticate = (
  request: Request,
  origin: string,
) => Promise<McpAuth>;

/** Who got in: the user and the scopes they approved. */
interface Admitted {
  readonly user: Readonly<User>;
  readonly scope: readonly string[];
}

/**
 * The 503 for a fault while checking who is calling (a database that cannot be
 * reached): a JSON-RPC internal error with `Retry-After`, so a client backs off
 * and tries again instead of treating a bare 500 page as the final word. Nothing
 * of the fault itself is sent.
 */
function authFault(cors: Readonly<Record<string, string>>): Response {
  return Response.json(
    errorBody(ERROR_INTERNAL, 'Something went wrong on the server.'),
    {
      status: 503,
      headers: { ...cors, ...NO_STORE, 'Retry-After': '5' },
    },
  );
}

/**
 * Let a request in, or answer it: 403 for an origin that is not allowed, 401
 * for a missing or invalid bearer token, 503 if the token could not be checked.
 */
async function admit(
  request: Request,
  origin: string,
  authenticate: Authenticate,
): Promise<Admitted | Response> {
  const refused = originRefusal(request, origin);
  if (refused) {
    return refused;
  }
  const cors = corsFor(request, origin);
  try {
    const auth = await authenticate(request, origin);
    return auth.kind === 'ok'
      ? auth
      : unauthorizedResponse(origin, auth.kind === 'invalid-token', cors);
  } catch (error) {
    logError({ event: 'mcp.bearer_check_failed', error: errorMessage(error) });
    return authFault(cors);
  }
}

/**
 * The whole of the MCP endpoint, from origin check to reply, for any method:
 * `OPTIONS` is the CORS preflight (204, or 403 for an origin that is not
 * allowed), `POST` is a JSON-RPC message for a signed-in caller, and anything
 * else (`GET`, `DELETE`) gets 405 with `Allow: POST, OPTIONS` once the caller is
 * known, because the server has no event stream and no session to end.
 *
 * `POST /mcp` and the conformance harness both call this, so the harness
 * cannot drift from what runs in production. `rate` is where the counters live.
 */
export async function respondToMcp(
  request: Request,
  origin: string,
  authenticate: Authenticate,
  rate: RateLimitDeps = liveRateLimitDeps(),
): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return (
      originRefusal(request, origin) ??
      new Response(null, {
        status: 204,
        headers: { ...corsFor(request, origin), Allow: 'POST, OPTIONS' },
      })
    );
  }
  const admitted = await admit(request, origin, authenticate);
  if (admitted instanceof Response) {
    return admitted;
  }
  return request.method === 'POST'
    ? handleMcpPost(request, admitted.user, admitted.scope, origin, rate)
    : new Response(null, {
        status: 405,
        headers: {
          ...corsFor(request, origin),
          ...NO_STORE,
          Allow: 'POST, OPTIONS',
        },
      });
}
