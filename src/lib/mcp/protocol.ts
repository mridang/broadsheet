/**
 * @packageDocumentation
 *
 * The protocol rules of the MCP endpoint that don't depend on what the tools do:
 * which protocol versions we speak, how a version is agreed, which origins may
 * call us from a browser, and the checks the newest revision (2026-07-28) puts
 * on every request's HTTP headers.
 *
 * The server speaks two eras at once. Older clients open with an `initialize`
 * handshake and we answer with the newest older version we share with them.
 * Newer clients send their version, name and capabilities with every request
 * (in `_meta`, mirrored into headers) and never handshake; they may ask
 * `server/discover` first. Both are served from the same endpoint, and neither
 * needs a session, because the server keeps no state between requests.
 */

import { base64ToBytes } from '@/utils/base64';
import { parseUrl } from '@/utils/url';

/** The newest revision, which has no handshake and no sessions. */
export const MODERN_VERSION = '2026-07-28';

/**
 * Revisions that open with an `initialize` handshake, newest first.
 *
 * `2024-11-05` is negotiable here, but the HTTP+SSE transport that revision was
 * defined for is not hosted (a GET answers 405, the documented signal to fall
 * back): a client can ask for that version over streamable HTTP, a client that
 * can only speak HTTP+SSE cannot connect. Batches (removed in 2025-06-18) and an
 * `initialize` inside a batch (forbidden since 2025-03-26) are accepted too;
 * both are harmless over-acceptance.
 */
export const LEGACY_VERSIONS = [
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
] as const;

/** Every revision we speak, newest first. */
export const SUPPORTED_VERSIONS: readonly string[] = [
  MODERN_VERSION,
  ...LEGACY_VERSIONS,
];

/** JSON-RPC error code: the body is not JSON. */
export const ERROR_PARSE = -32_700;
/** JSON-RPC error code: the body is JSON but not a valid request. */
export const ERROR_INVALID_REQUEST = -32_600;
/** JSON-RPC error code: no such method. */
export const ERROR_METHOD_NOT_FOUND = -32_601;
/** JSON-RPC error code: the method exists but its parameters are wrong. */
export const ERROR_INVALID_PARAMS = -32_602;
/** JSON-RPC error code: the server failed in a way the caller cannot fix. */
export const ERROR_INTERNAL = -32_603;
/** MCP error code: a request header disagrees with the request body. */
export const ERROR_HEADER_MISMATCH = -32_020;
/** MCP error code: the protocol version asked for is not one we speak. */
export const ERROR_UNSUPPORTED_VERSION = -32_022;

/**
 * The version to answer an `initialize` with: the one the client asked for if we
 * speak it, otherwise the newest older revision. (Only handshake-based versions
 * are offered here; a client that wants the newest revision does not handshake.).
 */
export function negotiateLegacyVersion(requested: unknown): string {
  return typeof requested === 'string' &&
    (LEGACY_VERSIONS as readonly string[]).includes(requested)
    ? requested
    : LEGACY_VERSIONS[0];
}

/** The `_meta` key where the newest revision's requests state their protocol version. */
const META_VERSION = 'io.modelcontextprotocol/protocolVersion';
/** The `_meta` key where the newest revision's requests list what the client can do. */
const META_CAPABILITIES = 'io.modelcontextprotocol/clientCapabilities';

/**
 * The id a reply carries: the request's, or null when it had none (or when it
 * could not be read, which is the only time the spec lets a reply drop it).
 */
export type ReplyId = number | string | null;

/** Whether a value is a plain JSON object (not null, an array or a scalar). */
export function isPlainObject(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The id to echo for a request: its own when it is a string or an integer (the
 * only ids JSON-RPC in MCP allows), otherwise null.
 */
function isReplyId(value: unknown): value is string | number {
  return (
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isSafeInteger(value))
  );
}

export function replyIdOf(value: unknown): ReplyId {
  return isReplyId(value) ? value : null;
}

/**
 * A JSON-RPC error raised while handling a request. The request router turns
 * it into the error reply, so handlers can say "this is the caller's mistake"
 * without building the reply themselves.
 */
export class RpcError extends Error {
  override readonly name = 'RpcError';

  /**
   * @param code - The JSON-RPC error code.
   * @param message - What went wrong, written for the caller.
   * @param data - Extra detail for the caller, when there is any.
   */
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

/** A JSON-RPC message as far as protocol checks care. */
export interface ProtocolMessage {
  readonly jsonrpc?: string;
  readonly id?: number | string | null;
  readonly method?: string;
  readonly params?: Readonly<Record<string, unknown>> & {
    readonly _meta?: Readonly<Record<string, unknown>>;
  };
}

/** Whether a message is a notification: it expects no reply, whatever it announces. */
export function isNotification(message: ProtocolMessage): boolean {
  return (
    typeof message.method === 'string' &&
    message.method.startsWith('notifications/')
  );
}

/** The protocol version a request declares in its `_meta`, if it does (and says it as text). */
export function declaredVersion(message: ProtocolMessage): string | undefined {
  const value = message.params?._meta?.[META_VERSION];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Whether a request is in the newest era: it carries that revision's version in
 * `_meta`. The older revisions only exist after an `initialize` handshake, so a
 * request naming one of them per request is not a newest-era request (and is
 * refused by {@link checkRequestHeaders}).
 */
export function isModernRequest(message: ProtocolMessage): boolean {
  return declaredVersion(message) === MODERN_VERSION;
}

/** What to send when a request is refused: an HTTP status plus a JSON-RPC error body. */
type RefusalStatus = 400 | 403 | 404 | 413 | 429;

export interface ProtocolRefusal {
  readonly status: RefusalStatus;
  /** Extra response headers (`Retry-After`, `WWW-Authenticate`). */
  readonly headers?: Readonly<Record<string, string>>;
  readonly body: {
    readonly jsonrpc: '2.0';
    readonly id: ReplyId;
    readonly error: {
      readonly code: number;
      readonly message: string;
      readonly data?: unknown;
    };
  };
}

/** Everything a refusal is made of. */
export interface RefusalSpec {
  readonly status: ProtocolRefusal['status'];
  readonly code: number;
  readonly message: string;
  /** The request's id, when it could be read. */
  readonly id?: ReplyId;
  readonly data?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}

/** A JSON-RPC error reply body. The id defaults to null, for when no request could be read. */
export function errorBody(
  code: number,
  message: string,
  id: ReplyId = null,
  data?: unknown,
): ProtocolRefusal['body'] {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}

/** Build a refusal: the HTTP status, any extra headers, and the JSON-RPC error body. */
export function protocolRefusal(spec: RefusalSpec): ProtocolRefusal {
  return {
    status: spec.status,
    ...(spec.headers ? { headers: spec.headers } : {}),
    body: errorBody(spec.code, spec.message, spec.id, spec.data),
  };
}

/**
 * The same refusal without a request id. A batch is answered with one error for
 * the whole body, which belongs to no single request in it.
 */
export function withoutId(refusal: ProtocolRefusal): ProtocolRefusal {
  return { ...refusal, body: { ...refusal.body, id: null } };
}

/** The refusal for a version we don't speak, listing the ones we do. */
function unsupportedVersion(
  requested: string,
  id: ReplyId,
  message = 'Unsupported protocol version',
): ProtocolRefusal {
  return protocolRefusal({
    status: 400,
    code: ERROR_UNSUPPORTED_VERSION,
    message,
    id,
    data: { supported: SUPPORTED_VERSIONS, requested },
  });
}

/** A 400 for a request that is missing something the newest revision requires of every request. */
function malformed(message: string, id: ReplyId): ProtocolRefusal {
  return protocolRefusal({
    status: 400,
    code: ERROR_INVALID_PARAMS,
    message,
    id,
  });
}

/** A 400 for a header that disagrees with the body. */
function mismatch(message: string, id: ReplyId): ProtocolRefusal {
  return protocolRefusal({
    status: 400,
    code: ERROR_HEADER_MISMATCH,
    message,
    id,
  });
}

/** What came of looking at one parsed JSON value that should be a JSON-RPC message. */
export type ParsedMessage =
  | {
      /** A call that expects a reply, or a notification that does not. */
      readonly kind: 'request' | 'notification';
      readonly message: ProtocolMessage;
    }
  /** A reply to something a server asked: we never ask, so there is nothing to do. */
  | { readonly kind: 'response' }
  /** Not a valid message; send this refusal. */
  | { readonly kind: 'invalid'; readonly refusal: ProtocolRefusal };

/** A refusal for a body that is not a valid JSON-RPC message (HTTP 400). */
function invalid(
  code: number,
  message: string,
  id: ReplyId = null,
): ParsedMessage {
  return {
    kind: 'invalid',
    refusal: protocolRefusal({ status: 400, code, message, id }),
  };
}

/**
 * Check one parsed JSON value is a well-formed JSON-RPC 2.0 message and say
 * what kind it is:
 *
 *  - a reply (`result` or `error`, no `method`) is not for us to answer;
 *  - `jsonrpc` must be `"2.0"` and `method` a string;
 *  - `params`, and `params._meta`, must be objects when present (a `null`
 *    `params` is read as absent, which some clients send for methods that take none);
 *  - a request's `id` must be a string or an integer, never null; one with no
 *    id is a notification and only `notifications/*` methods may be sent so.
 *
 * Whatever id could be read is echoed back in the refusal.
 */
export function parseMessage(raw: unknown): ParsedMessage {
  if (!isPlainObject(raw)) {
    return invalid(ERROR_INVALID_REQUEST, 'Invalid Request');
  }
  const { method, params } = raw;
  const id = replyIdOf(raw['id']);
  if (typeof method !== 'string' && ('result' in raw || 'error' in raw)) {
    return { kind: 'response' };
  }
  if (raw['jsonrpc'] !== '2.0') {
    return invalid(ERROR_INVALID_REQUEST, '"jsonrpc" must be "2.0".', id);
  }
  if (typeof method !== 'string' || method === '') {
    return invalid(ERROR_INVALID_REQUEST, '"method" must be a string.', id);
  }
  if (params !== null && 'params' in raw && !isPlainObject(params)) {
    return invalid(ERROR_INVALID_PARAMS, '"params" must be an object.', id);
  }
  if (
    isPlainObject(params) &&
    '_meta' in params &&
    !isPlainObject(params['_meta'])
  ) {
    return invalid(
      ERROR_INVALID_PARAMS,
      '"params._meta" must be an object.',
      id,
    );
  }
  if ('id' in raw && id === null) {
    return invalid(
      ERROR_INVALID_REQUEST,
      '"id" must be a string or an integer (never null).',
    );
  }
  const message: ProtocolMessage = {
    jsonrpc: '2.0',
    method,
    ...('id' in raw ? { id } : {}),
    ...(isPlainObject(params) ? { params } : {}),
  };
  // A `notifications/*` method that carries an id is still treated as a
  // notification (answered 202, no body). JSON-RPC would call it a request, but
  // answering it with an error would only trip clients that stamp every message
  // with a counter, and none waits for a reply to a notification, so being
  // lenient costs nothing. Only the newest revision forbids the id outright, and
  // being liberal in what we accept is allowed there.
  if (isNotification(message)) {
    return { kind: 'notification', message };
  }
  return 'id' in raw
    ? { kind: 'request', message }
    : invalid(
        ERROR_INVALID_REQUEST,
        `"${method}" is a request, not a notification, so it needs an "id".`,
      );
}

/** The protocol version a request's `MCP-Protocol-Version` header names, if it sends one. */
export function headerVersion(headers: Headers): string | undefined {
  const value = headers.get('mcp-protocol-version')?.trim();
  return value || undefined;
}

/**
 * Check a batch is allowed. Batches belong to the older revisions (2025-03-26
 * asks servers to accept them); the newest revision's body is a single message,
 * and a batch can't carry the per-message headers it requires. So a batch that
 * says it is newest-era, in its headers or in any member, is refused.
 */
export function checkBatch(
  headers: Headers,
  messages: readonly ProtocolMessage[],
): ProtocolRefusal | null {
  return headerVersion(headers) === MODERN_VERSION ||
    messages.some((message) => isModernRequest(message))
    ? protocolRefusal({
        status: 400,
        code: ERROR_INVALID_REQUEST,
        message: `Protocol ${MODERN_VERSION} takes one message per request; batches are only for older clients.`,
      })
    : null;
}

/**
 * Check one message's `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name`
 * headers against what it says in its body, and its per-request `_meta`.
 * Returns the refusal to send (carrying the message's id), or null when the
 * request is fine.
 *
 *  - A version header we don't speak is refused, whichever era the message is in.
 *  - A notification has no further requirements: the revision defines none.
 *  - A request with no `_meta` version is an older-era request and may omit every
 *    header. But one whose header says 2026-07-28 has no `_meta` to match it,
 *    which makes it malformed.
 *  - A request that declares a version in `_meta` must declare it as text, agree
 *    with the header if there is one (else `-32020`), name a version we speak, and that must be 2026-07-28: the older revisions are only
 *    reached by `initialize`. It must repeat that version in the header, carry
 *    the client's capabilities as an object, and `Mcp-Method` (and `Mcp-Name` for
 *    calls that name something) must match too: a gateway may route on the
 *    headers while we act on the body, so the two must never disagree.
 */
export function checkRequestHeaders(
  headers: Headers,
  message: ProtocolMessage,
): ProtocolRefusal | null {
  const id = replyIdOf(message.id);
  const fromHeader = headerVersion(headers);
  if (fromHeader !== undefined && !SUPPORTED_VERSIONS.includes(fromHeader)) {
    return unsupportedVersion(fromHeader, id);
  }
  if (isNotification(message)) {
    return null;
  }
  const meta = message.params?._meta;
  const fromBody: unknown = meta?.[META_VERSION];
  if (fromBody === undefined) {
    return fromHeader === MODERN_VERSION
      ? malformed(
          `MCP-Protocol-Version is "${MODERN_VERSION}" but the request has no _meta["${META_VERSION}"] (and _meta["${META_CAPABILITIES}"]).`,
          id,
        )
      : null;
  }
  if (typeof fromBody !== 'string') {
    return malformed(`_meta["${META_VERSION}"] must be a string.`, id);
  }
  if (!SUPPORTED_VERSIONS.includes(fromBody)) {
    // A header that names another version is the more basic fault: the two
    // places must agree before it matters whether we speak what they say.
    return fromHeader !== undefined && fromHeader !== fromBody
      ? mismatch(
          `Header mismatch: MCP-Protocol-Version is "${fromHeader}" but the body says "${fromBody}".`,
          id,
        )
      : unsupportedVersion(fromBody, id);
  }
  if (fromBody !== MODERN_VERSION) {
    return unsupportedVersion(
      fromBody,
      id,
      `Protocol ${fromBody} starts with an initialize handshake; per-request metadata is for ${MODERN_VERSION}.`,
    );
  }
  if (fromHeader !== fromBody) {
    const shownHeader = fromHeader ? `"${fromHeader}"` : 'missing';
    return mismatch(
      `Header mismatch: MCP-Protocol-Version is ${shownHeader} but the body says "${fromBody}".`,
      id,
    );
  }
  if (!isPlainObject(meta?.[META_CAPABILITIES])) {
    return malformed(
      `_meta["${META_CAPABILITIES}"] is required and must be an object.`,
      id,
    );
  }
  const method = message.method ?? '';
  if (headers.get('mcp-method') !== method) {
    return mismatch(`Header mismatch: Mcp-Method must be "${method}".`, id);
  }
  const name = nameOf(message);
  if (
    name !== undefined &&
    decodeHeaderValue(headers.get('mcp-name')) !== name
  ) {
    return mismatch(
      'Header mismatch: Mcp-Name must be the name or URI the request asks for.',
      id,
    );
  }
  return null;
}

/** What a request names, for the calls that name something. */
function nameOf(message: ProtocolMessage): string | undefined {
  const params = message.params ?? {};
  switch (message.method) {
    case 'tools/call':
    case 'prompts/get': {
      return typeof params['name'] === 'string' ? params['name'] : undefined;
    }
    case 'resources/read': {
      return typeof params['uri'] === 'string' ? params['uri'] : undefined;
    }
    default: {
      return undefined;
    }
  }
}

/** A header value, decoding the `=?base64?…?=` form used for non-ASCII values. */
export function decodeHeaderValue(value: string | null): string | undefined {
  if (value === null) {
    return undefined;
  }
  const encoded = /^=\?base64\?(.*)\?=$/.exec(value)?.[1];
  if (encoded === undefined) {
    return value;
  }
  try {
    return new TextDecoder().decode(base64ToBytes(encoded));
  } catch {
    return undefined;
  }
}

/**
 * Origins that may call the endpoint from a browser, besides our own: the web
 * apps of the assistants that connect to us and local tools such as the MCP
 * Inspector. More can be added with the `MCP_ALLOWED_ORIGINS` setting (a
 * comma-separated list of origins).
 */
const ALLOWED_HOSTS: readonly string[] = [
  'claude.ai',
  'claude.com',
  'chatgpt.com',
  'chat.openai.com',
  'openai.com',
  'anthropic.com',
];

/**
 * The origins an operator has added with the `MCP_ALLOWED_ORIGINS` setting: a
 * comma-separated list, each entry an origin exactly as a browser sends it
 * (`https://tool.example`, `chrome-extension://abcdef`). Blank entries, `*` and
 * `null` are dropped: `*` would switch the check off, and `null` is what any
 * sandboxed frame or local file sends, so it says nothing about who is calling.
 */
export function parseAllowedOrigins(
  setting: string | undefined,
): readonly string[] {
  return (setting ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '' && entry !== '*' && entry !== 'null');
}

/**
 * Whether a request's `Origin` header may reach the endpoint. A request with no
 * `Origin` (a server or a desktop app) is fine. One with an origin we don't
 * recognise is refused, so a web page can't make a visitor's browser talk to the
 * endpoint on its own behalf (DNS rebinding and its cousins).
 *
 * `extra` is the `MCP_ALLOWED_ORIGINS` setting. It is matched first and as
 * written, before the origin is parsed, because the built-in rules below only
 * understand web origins: for `chrome-extension://abc`, `vscode-webview://abc`
 * or `tauri://localhost` the URL parser reports an opaque origin, which would
 * otherwise make it impossible to allow the very clients (extensions, Electron
 * and webview apps) that need the setting.
 */
export function isAllowedOrigin(
  origin: string | null,
  selfOrigin: string,
  extra: string | undefined = undefined,
): boolean {
  if (origin === null || origin === selfOrigin) {
    return true;
  }
  if (parseAllowedOrigins(extra).includes(origin)) {
    return true;
  }
  const url = parseUrl(origin);
  if (!url) {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (url.origin !== origin) {
    return false; // an origin has no path
  }
  if (['localhost', '127.0.0.1', '[::1]'].includes(host)) {
    return true;
  }
  return (
    url.protocol === 'https:' &&
    ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
  );
}
