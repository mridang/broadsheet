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
  RESOURCE_NOT_FOUND,
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
  /**
   * Whether it may remove or overwrite something the person cannot get back.
   * Hosts use this to decide when to ask before a call, so it is set from what
   * the tool really does, not from its name: a tool that deletes a row the
   * person created is destructive even when the word "remove" is not in it.
   * Left out it means false, which is what a tool that only adds or changes
   * its own last answer should say.
   */
  readonly destructive?: boolean;
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
export class ToolFailureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolFailureError';
  }
}

/**
 * A resource the server offers: a fixed `uri`, or a `uriTemplate` whose
 * `match` picks out the parameters of a concrete URI. `read` returns JSON.
 */
export interface McpResource<Ctx> {
  readonly name: string;
  readonly description: string;
  readonly uri?: string;
  readonly uriTemplate?: string;
  /** For a template: the parameters of `uri`, or undefined when it is not one. */
  readonly match?: (
    uri: string,
  ) => Readonly<Record<string, string>> | undefined;
  readonly read: (
    params: Readonly<Record<string, string>>,
    ctx: Ctx,
  ) => Promise<object>;
}

/** A prompt the server offers: a ready-made request for the assistant. */
export interface McpPrompt {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly arguments: readonly {
    readonly name: string;
    readonly description: string;
    readonly required?: boolean;
  }[];
  /** The text of the request, from its arguments. */
  readonly render: (args: Readonly<Record<string, string>>) => string;
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
  readonly #resources: readonly McpResource<Ctx>[];
  readonly #prompts: ReadonlyMap<string, McpPrompt>;

  constructor(
    info: ServerInfo,
    instructions: string,
    tools: readonly McpTool<Ctx>[],
    resources: readonly McpResource<Ctx>[] = [],
    prompts: readonly McpPrompt[] = [],
  ) {
    this.#info = info;
    this.#instructions = instructions;
    this.#tools = new Map(tools.map((t) => [t.name, t]));
    this.#resources = resources;
    this.#prompts = new Map(prompts.map((p) => [p.name, p]));
  }

  /** Read the resource at a URI. */
  async #readResource(
    params: Readonly<Record<string, unknown>>,
    ctx: Ctx,
  ): Promise<object> {
    const uri = params['uri'];
    if (typeof uri !== 'string') {
      throw new RpcError(ERROR_INVALID_PARAMS, 'Send the uri.');
    }
    for (const resource of this.#resources) {
      const found = resource.uri === uri ? {} : resource.match?.(uri);
      if (found) {
        return this.#readFound(resource, found, uri, ctx);
      }
    }
    throw new RpcError(RESOURCE_NOT_FOUND, 'Resource not found', { uri });
  }

  /** Read a resource whose parameters were found for the URI. */
  async #readFound(
    resource: McpResource<Ctx>,
    found: Readonly<Record<string, string>>,
    uri: string,
    ctx: Ctx,
  ): Promise<object> {
    try {
      const data = await resource.read(found, ctx);
      return {
        contents: [
          { uri, mimeType: 'application/json', text: JSON.stringify(data) },
        ],
      };
    } catch (error) {
      if (error instanceof ToolFailureError) {
        throw new RpcError(RESOURCE_NOT_FOUND, error.message, { uri });
      }
      throw error;
    }
  }

  /** Render a prompt with its arguments. */
  #getPrompt(params: Readonly<Record<string, unknown>>): object {
    const prompt = this.#prompts.get(String(params['name']));
    if (!prompt) {
      throw new RpcError(ERROR_INVALID_PARAMS, 'No such prompt.');
    }
    const given = isPlainObject(params['arguments']) ? params['arguments'] : {};
    const args = Object.fromEntries(
      Object.entries(given).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
    const missing = prompt.arguments.find((a) => a.required && !args[a.name]);
    if (missing) {
      throw new RpcError(ERROR_INVALID_PARAMS, `Send ${missing.name}.`);
    }
    return {
      description: prompt.description,
      messages: [
        { role: 'user', content: { type: 'text', text: prompt.render(args) } },
      ],
    };
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
          destructiveHint: t.destructive === true,
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
      if (error instanceof ToolFailureError) {
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
      case 'initialize': {
        return {
          protocolVersion: negotiateVersion(params['protocolVersion']),
          capabilities: {
            tools: { listChanged: false },
            resources: { listChanged: false, subscribe: false },
            prompts: { listChanged: false },
          },
          serverInfo: this.#info,
          instructions: this.#instructions,
        };
      }
      case 'ping': {
        return {};
      }
      case 'tools/list': {
        return this.#list();
      }
      case 'tools/call': {
        return this.#call(params, ctx);
      }
      case 'resources/list': {
        return {
          resources: this.#resources
            .filter((r) => r.uri)
            .map((r) => ({
              uri: r.uri,
              name: r.name,
              description: r.description,
              mimeType: 'application/json',
            })),
        };
      }
      case 'resources/templates/list': {
        return {
          resourceTemplates: this.#resources
            .filter((r) => r.uriTemplate)
            .map((r) => ({
              uriTemplate: r.uriTemplate,
              name: r.name,
              description: r.description,
              mimeType: 'application/json',
            })),
        };
      }
      case 'resources/read': {
        return this.#readResource(params, ctx);
      }
      case 'prompts/list': {
        return {
          prompts: [...this.#prompts.values()].map((p) => ({
            name: p.name,
            title: p.title,
            description: p.description,
            arguments: p.arguments,
          })),
        };
      }
      case 'prompts/get': {
        return this.#getPrompt(params);
      }
      default: {
        throw new RpcError(ERROR_METHOD_NOT_FOUND, 'Method not found');
      }
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
