/**
 * @packageDocumentation
 *
 * A transport-free MCP server over JSON-RPC 2.0, generic over a per-request
 * context `Ctx` so no domain type leaks into the engine. It answers the
 * handshake (`initialize`, `ping`) and the tools methods: each tool declares
 * a zod schema for its arguments, which is both what `tools/list` advertises
 * (as JSON Schema) and what `tools/call` checks before running it.
 *
 * Hand-rolled (no SDK) to keep the Worker bundle small; the HTTP binding
 * lives with the caller.
 */

import { z } from 'zod';

import { errorMessage, logError } from '@/utils/logging';
import {
  ERROR_INTERNAL,
  ERROR_INVALID_PARAMS,
  ERROR_METHOD_NOT_FOUND,
  RpcError,
  errorReply,
  isNotification,
  isPlainObject,
  negotiateVersion,
  replyIdOf,
  type JsonRpcMessage,
  type JsonRpcResponse,
} from './protocol';

/** One tool the server offers. */
export interface McpTool<Ctx, Input extends z.ZodObject = z.ZodObject> {
  readonly name: string;
  readonly title: string;
  /** What it does, in plain words, for the assistant choosing a tool. */
  readonly description: string;
  readonly input: Input;
  /** Whether it only reads (so a read-only grant may call it). */
  readonly readOnly: boolean;
  /** Run it; the result is sent back as structured content. */
  readonly run: (args: z.infer<Input>, ctx: Ctx) => Promise<object>;
}

/** Declare a tool, keeping its argument type tied to its schema. */
export function tool<Ctx, Input extends z.ZodObject>(
  definition: McpTool<Ctx, Input>,
): McpTool<Ctx> {
  return definition as unknown as McpTool<Ctx>;
}

/**
 * A tool's outcome the assistant can read and act on: a refusal it can fix
 * (bad arguments, no such item) rather than a protocol failure.
 */
export class ToolFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolFailure';
  }
}

/** How the server names itself. */
export interface ServerInfo {
  readonly name: string;
  readonly title: string;
  readonly version: string;
}

/** A tool result carrying text and the same data as structured content. */
function toolResult(data: object, isError = false): object {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: data,
    ...(isError ? { isError: true } : {}),
  };
}

/** A failed tool call, said in words. */
function toolError(message: string): object {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

/** The JSON-RPC MCP server. */
export class McpServer<Ctx> {
  readonly #info: ServerInfo;
  readonly #instructions: string;
  readonly #tools: ReadonlyMap<string, McpTool<Ctx>>;

  constructor(
    info: ServerInfo,
    instructions: string,
    tools: readonly McpTool<Ctx>[],
  ) {
    this.#info = info;
    this.#instructions = instructions;
    this.#tools = new Map(tools.map((t) => [t.name, t]));
  }

  /** The tool with this name, if the server offers it. */
  tool(name: unknown): McpTool<Ctx> | undefined {
    return typeof name === 'string' ? this.#tools.get(name) : undefined;
  }

  /** The `tools/list` entry of every tool. */
  #list(): object {
    return {
      tools: [...this.#tools.values()].map((t) => ({
        name: t.name,
        title: t.title,
        description: t.description,
        inputSchema: z.toJSONSchema(t.input, { io: 'input' }),
        annotations: {
          title: t.title,
          readOnlyHint: t.readOnly,
          destructiveHint: false,
          openWorldHint: false,
        },
      })),
    };
  }

  /** Run a `tools/call`. */
  async #call(
    params: Readonly<Record<string, unknown>>,
    ctx: Ctx,
  ): Promise<object> {
    const found = this.tool(params['name']);
    if (!found) {
      throw new RpcError(ERROR_INVALID_PARAMS, 'No such tool.');
    }
    const args = params['arguments'] ?? {};
    const parsed = found.input.safeParse(args);
    if (!parsed.success) {
      return toolError(
        `The arguments are not valid: ${parsed.error.issues
          .map((i) => `${i.path.join('.') || 'arguments'}: ${i.message}`)
          .join('; ')}`,
      );
    }
    try {
      return toolResult(await found.run(parsed.data, ctx));
    } catch (error) {
      if (error instanceof ToolFailure) {
        return toolError(error.message);
      }
      throw error;
    }
  }

  /** The result of one request, or a thrown {@link RpcError}. */
  async #dispatch(
    method: string,
    params: Readonly<Record<string, unknown>>,
    ctx: Ctx,
  ): Promise<object> {
    switch (method) {
      case 'initialize':
        return {
          protocolVersion: negotiateVersion(params['protocolVersion']),
          capabilities: { tools: { listChanged: false } },
          serverInfo: this.#info,
          instructions: this.#instructions,
        };
      case 'ping':
        return {};
      case 'tools/list':
        return this.#list();
      case 'tools/call':
        return this.#call(params, ctx);
      default:
        throw new RpcError(ERROR_METHOD_NOT_FOUND, 'Method not found');
    }
  }

  /**
   * Handle one message. Null for a notification, which expects no reply; a
   * refusal or failure becomes a JSON-RPC error carrying the request's id.
   */
  async handleMessage(
    message: JsonRpcMessage,
    ctx: Ctx,
  ): Promise<JsonRpcResponse | null> {
    if (isNotification(message)) {
      return null;
    }
    const id = replyIdOf(message.id);
    const params = isPlainObject(message.params) ? message.params : {};
    try {
      const result = await this.#dispatch(String(message.method), params, ctx);
      return { jsonrpc: '2.0', id, result };
    } catch (error) {
      if (error instanceof RpcError) {
        return errorReply(id, error.code, error.message, error.data);
      }
      // The detail stays in our logs: it can carry database errors.
      logError({ event: 'mcp.request_failed', error: errorMessage(error) });
      return errorReply(id, ERROR_INTERNAL, 'Something went wrong.');
    }
  }
}
