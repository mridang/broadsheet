/**
 * @packageDocumentation
 *
 * A transport-free Model Context Protocol server over JSON-RPC 2.0, generic
 * over a per-request context `Ctx` so no domain type leaks into the engine.
 * Callers register the methods they answer — each produces a result or throws
 * an {@link RpcError} to refuse — and the engine handles the envelope: it drops
 * notifications, gates methods by protocol era, dresses a result for the newest
 * revision (completion marker, cache hints, server identity in `_meta`), and
 * turns a refusal or an unexpected error into a JSON-RPC error reply.
 *
 * It is deliberately hand-rolled (no SDK) to keep the Worker bundle small: each
 * POST carries one JSON-RPC message (or a batch) and gets one JSON response.
 * Both the legacy handshake revisions and the stateless modern one are spoken
 * (see `protocol.ts`); the transport binding (reading the body, batching, CORS)
 * lives with the caller.
 */

import { errorMessage, logError } from '@/utils/logging';
import {
  ERROR_INTERNAL,
  ERROR_METHOD_NOT_FOUND,
  RpcError,
  isModernRequest,
  isNotification,
  isPlainObject,
  replyIdOf,
  type ReplyId,
} from '@/lib/mcp/protocol';

/** A JSON-RPC 2.0 request/notification, as received (clients may leave any member out). */
export interface JsonRpcMessage {
  readonly jsonrpc?: string;
  readonly id?: number | string | null;
  readonly method?: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

/** A JSON-RPC error: what went wrong, and detail for the caller when there is any. */
export interface JsonRpcErrorBody {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

/** A JSON-RPC reply: a result, or an error. */
export type JsonRpcResponse =
  | { readonly jsonrpc: '2.0'; readonly id: ReplyId; readonly result: object }
  | {
      readonly jsonrpc: '2.0';
      readonly id: ReplyId;
      readonly error: JsonRpcErrorBody;
    };

/** A successful reply. */
function succeeded(id: ReplyId, result: object): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

/** An error reply. */
function failed(
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

/**
 * Caching hints a cacheable result carries for the newest revision: how long a
 * client may reuse it and who may share the copy.
 */
export interface CacheHint {
  readonly ttlMs: number;
  readonly cacheScope: 'public' | 'private';
}

/** One method the server answers. */
export interface McpMethod<Ctx> {
  /** Produce the result, or throw an {@link RpcError} to refuse the request. */
  readonly handle: (
    params: Readonly<Record<string, unknown>> | undefined,
    ctx: Ctx,
  ) => object | Promise<object>;
  /** Caching hints for the result (fixed, or chosen from the result). */
  readonly cache?: CacheHint | ((result: object) => CacheHint);
  /** The method belongs to the newest revision only (and so always gets its result fields). */
  readonly modernOnly?: true;
  /** The newest revision removed the method; the older revisions still use it. */
  readonly legacyOnly?: true;
}

/** How the server names itself, for the newest revision's `_meta`. */
export interface McpServerOptions {
  readonly serverInfo: object;
  readonly serverInfoMetaKey: string;
}

/**
 * A JSON-RPC MCP server. Register the methods it answers, then feed it one
 * message at a time with {@link handleMessage}; the transport (HTTP body,
 * batching, CORS) is the caller's.
 */
export class McpServer<Ctx> {
  readonly #methods = new Map<string, McpMethod<Ctx>>();
  readonly #serverInfo: object;
  readonly #metaKey: string;

  constructor(options: McpServerOptions) {
    this.#serverInfo = options.serverInfo;
    this.#metaKey = options.serverInfoMetaKey;
  }

  /** Register a method the server answers. */
  register(method: string, handler: McpMethod<Ctx>): this {
    this.#methods.set(method, handler);
    return this;
  }

  /** The `_meta` of a result, when it has one. */
  #metaOf(result: object): Readonly<Record<string, unknown>> {
    return '_meta' in result && isPlainObject(result._meta) ? result._meta : {};
  }

  /**
   * Dress a successful result for the newest revision: it says it is complete,
   * carries the caching hints of its method, and names the server in `_meta`
   * (merged into any `_meta` the result already has). Older revisions get the
   * result as it is.
   */
  #forModernClient(result: object, method: McpMethod<Ctx>): object {
    return {
      ...result,
      ...(typeof method.cache === 'function'
        ? method.cache(result)
        : (method.cache ?? {})),
      ...('resultType' in result ? {} : { resultType: 'complete' }),
      _meta: { ...this.#metaOf(result), [this.#metaKey]: this.#serverInfo },
    };
  }

  /** The error reply for something that went wrong while handling a request. */
  #faultReply(id: ReplyId, error: unknown): JsonRpcResponse {
    if (error instanceof RpcError) {
      return failed(id, error.code, error.message, error.data);
    }
    // What went wrong stays in our logs: the text can carry upstream replies or
    // database details, which should not travel on to an assistant.
    logError({ event: 'mcp.request_failed', error: errorMessage(error) });
    return failed(id, ERROR_INTERNAL, 'Something went wrong on the server.');
  }

  /**
   * Handle one JSON-RPC message against the per-request context. Returns the
   * response object, or null for a notification (which expects no reply). A
   * refusal is returned as a JSON-RPC error carrying the request's id.
   */
  async handleMessage(
    message: JsonRpcMessage,
    ctx: Ctx,
  ): Promise<JsonRpcResponse | null> {
    if (isNotification(message)) {
      return null;
    }
    const id = replyIdOf(message.id);
    const method = this.#methods.get(message.method ?? '');
    if (!method || (method.legacyOnly && isModernRequest(message))) {
      return failed(id, ERROR_METHOD_NOT_FOUND, 'Method not found');
    }
    try {
      const result = await method.handle(message.params, ctx);
      return succeeded(
        id,
        method.modernOnly || isModernRequest(message)
          ? this.#forModernClient(result, method)
          : result,
      );
    } catch (error) {
      return this.#faultReply(id, error);
    }
  }
}
