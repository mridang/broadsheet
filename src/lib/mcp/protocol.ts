/**
 * @packageDocumentation
 *
 * The JSON-RPC 2.0 vocabulary of the Model Context Protocol: protocol
 * revisions, error codes and the shape checks every message goes through.
 * Each POST carries one message and gets one JSON reply; there are no
 * sessions or event streams.
 */

/** The revisions this server speaks, newest first. */
export const SUPPORTED_VERSIONS: readonly string[] = [
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
];

/** Invalid JSON. */
export const ERROR_PARSE = -32_700;
/** Not a JSON-RPC request. */
export const ERROR_INVALID_REQUEST = -32_600;
/** No such method. */
export const ERROR_METHOD_NOT_FOUND = -32_601;
/** The parameters do not fit the method. */
export const ERROR_INVALID_PARAMS = -32_602;
/** Something failed on our side. */
export const ERROR_INTERNAL = -32_603;
/** No resource at that URI (the MCP spec's code). */
export const RESOURCE_NOT_FOUND = -32_002;

/**
 * The revision to answer an `initialize` with: the client's when we speak it,
 * else our newest (the client then decides whether it can go on).
 */
export function negotiateVersion(requested: unknown): string {
  return typeof requested === 'string' && SUPPORTED_VERSIONS.includes(requested)
    ? requested
    : SUPPORTED_VERSIONS[0]!;
}

/** The id a reply carries. */
export type ReplyId = number | string | null;

/** Whether a value is a plain JSON object. */
export function isPlainObject(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A JSON-RPC 2.0 message, as received (any member may be missing). */
export interface JsonRpcMessage {
  readonly jsonrpc?: unknown;
  readonly id?: unknown;
  readonly method?: unknown;
  readonly params?: unknown;
}

/** Whether a message is a well-formed request or notification. */
export function isJsonRpcMessage(value: unknown): value is JsonRpcMessage {
  return (
    isPlainObject(value) &&
    value['jsonrpc'] === '2.0' &&
    typeof value['method'] === 'string' &&
    (value['params'] === undefined || isPlainObject(value['params'])) &&
    (value['id'] === undefined ||
      typeof value['id'] === 'string' ||
      typeof value['id'] === 'number')
  );
}

/** A message with no id expects no reply. */
export function isNotification(message: JsonRpcMessage): boolean {
  return message.id === undefined;
}

/** The id to reply with: the request's, or null when it had none usable. */
export function replyIdOf(value: unknown): ReplyId {
  return typeof value === 'string' || typeof value === 'number' ? value : null;
}

/** A refusal a method handler throws; it becomes a JSON-RPC error reply. */
export class RpcError extends Error {
  readonly code: number;
  readonly data: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
    this.data = data;
  }
}

/** A JSON-RPC reply: a result or an error. */
export type JsonRpcResponse =
  | { readonly jsonrpc: '2.0'; readonly id: ReplyId; readonly result: object }
  | {
      readonly jsonrpc: '2.0';
      readonly id: ReplyId;
      readonly error: {
        readonly code: number;
        readonly message: string;
        readonly data?: unknown;
      };
    };

/** An error reply. */
export function errorReply(
  id: ReplyId,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}
