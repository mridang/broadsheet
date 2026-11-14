/**
 * @packageDocumentation
 *
 * This app's MCP server: the shared engine with this app's methods registered.
 *
 * The engine knows JSON-RPC and nothing else. What a tool, a resource or a
 * prompt is belongs to the app, so the handshake, the tool methods and the
 * resource and prompt methods are registered here and the engine only routes
 * to them.
 */

import {
  ERROR_INVALID_PARAMS,
  InvalidToolArgumentsError,
  McpServer,
  RpcError,
  UnknownToolError,
  isPlainObject,
  negotiateLegacyVersion,
  type ToolArgs,
  JsonRpcResponse,
} from '@/lib/mcp';

export type { JsonRpcResponse } from '@/lib/mcp';
import {
  INSTRUCTIONS,
  SERVER_INFO,
  SERVER_INFO_META_KEY,
} from '@/domain/mcp/server-info';
import { PROMPTS } from '@/domain/mcp/prompts';
import { RESOURCES } from '@/domain/mcp/resources';
import { callToolOrExplain } from '@/domain/mcp/tool-calls';
import { TOOLS } from '@/domain/mcp/tool-definitions';
import { ToolFailureError } from '@/domain/mcp/tool-failure';
import { toolContext, type ToolContext } from '@/domain/mcp/tool-context';
import type { ToolServices } from '@/domain/mcp/tool-services';
import type { User } from '@/domain/db/users';
import { TOOL_REGISTRY } from '@/domain/mcp/tools';

/** What runs a `tools/call`; a test passes its own. */
export type ToolRunner = typeof callToolOrExplain;

/** What the engine hands every method of this server. */
interface McpContext {
  readonly tools: ToolContext;
  readonly runTool: ToolRunner;
}

/**
 * Whether `name` is a tool this server advertises, which the HTTP layer asks
 * before it decides what sign-in a call needs.
 */
export function isAdvertisedTool(name: unknown): name is string {
  return typeof name === 'string' && TOOL_REGISTRY.has(name);
}

/** The `initialize` reply: what this server is and what it can do. */
function initializeResult(params: ToolArgs | undefined): object {
  return {
    protocolVersion: negotiateLegacyVersion(params?.['protocolVersion']),
    capabilities: {
      tools: { listChanged: false },
      resources: { listChanged: false, subscribe: false },
      prompts: { listChanged: false },
    },
    serverInfo: SERVER_INFO,
    instructions: INSTRUCTIONS,
  };
}

/** The answer to `resources/list`: every resource with a fixed address. */
function resourceListResult(): object {
  return {
    resources: RESOURCES.filter((resource) => resource.uri).map(
      ({ uri, name, description }) => ({
        uri,
        name,
        description,
        mimeType: 'application/json',
      }),
    ),
  };
}

/** The answer to `resources/templates/list`: the addresses with parameters. */
function resourceTemplateListResult(): object {
  return {
    resourceTemplates: RESOURCES.filter((resource) => resource.uriTemplate).map(
      ({ uriTemplate, name, description }) => ({
        uriTemplate,
        name,
        description,
        mimeType: 'application/json',
      }),
    ),
  };
}

/**
 * The reply to `resources/read`.
 * @throws {RpcError} If no `uri` was sent, or no resource answers to it.
 */
async function readResource(
  params: ToolArgs | undefined,
  { tools }: McpContext,
): Promise<object> {
  const uri = params?.['uri'];
  if (typeof uri !== 'string') {
    throw new RpcError(ERROR_INVALID_PARAMS, 'Send the uri.');
  }
  const match = RESOURCES.map((resource) => ({
    resource,
    found: resource.uri === uri ? {} : resource.match?.(uri),
  })).find((candidate) => candidate.found);
  if (!match?.found) {
    throw new RpcError(ERROR_INVALID_PARAMS, 'Resource not found', { uri });
  }
  try {
    const data = await match.resource.read(match.found, tools);
    return {
      contents: [
        { uri, mimeType: 'application/json', text: JSON.stringify(data) },
      ],
    };
  } catch (error) {
    if (error instanceof ToolFailureError) {
      throw new RpcError(ERROR_INVALID_PARAMS, error.message, { uri });
    }
    throw error;
  }
}

/** The answer to `prompts/list`. */
function promptListResult(): object {
  return {
    prompts: PROMPTS.map(({ name, title, description, arguments: args }) => ({
      name,
      title,
      description,
      arguments: args,
    })),
  };
}

/**
 * The answer to `prompts/get`: the request, rendered from its arguments.
 * @throws {RpcError} If no such prompt exists, or a required argument is absent.
 */
function promptResult(params: ToolArgs | undefined): object {
  const prompt = PROMPTS.find(
    (candidate) => candidate.name === String(params?.['name']),
  );
  if (!prompt) {
    throw new RpcError(ERROR_INVALID_PARAMS, 'No such prompt.');
  }
  const given = isPlainObject(params?.['arguments']) ? params['arguments'] : {};
  const args = Object.fromEntries(
    Object.entries(given).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
  const missing = prompt.arguments.find(
    (argument) => argument.required && !args[argument.name],
  );
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

/**
 * Run a `tools/call` through whatever runs tools for this request.
 *
 * A name no tool answers to, and arguments that are not an object at all, are
 * malformed requests rather than tool failures, so they are answered `-32602`
 * and not as a tool result. Arguments that are an object but do not fit the
 * tool's schema are the tool's own refusal, which the invoker words.
 */
async function callTool(
  params: ToolArgs | undefined,
  { tools, runTool }: McpContext,
): Promise<object> {
  const named = params?.['name'];
  const tool = typeof named === 'string' ? named : 'no name given';
  try {
    return await runTool(tools.user, params, tools.services);
  } catch (error) {
    if (error instanceof UnknownToolError) {
      throw new RpcError(
        ERROR_INVALID_PARAMS,
        `Unknown tool: ${error.tool}. The tools are ${[...TOOL_REGISTRY.names].join(', ')}.`,
      );
    }
    if (error instanceof InvalidToolArgumentsError) {
      throw new RpcError(
        ERROR_INVALID_PARAMS,
        `Invalid arguments for tool ${tool}: ${error.problems.join(' ')}`,
        { tool, problems: error.problems },
      );
    }
    throw error;
  }
}

/** This app's MCP server: the engine with its methods registered. */
const server = new McpServer<McpContext>({
  serverInfo: SERVER_INFO,
  serverInfoMetaKey: SERVER_INFO_META_KEY,
})
  .register('initialize', { handle: initializeResult })
  .register('ping', { handle: () => ({}) })
  .register('tools/list', { handle: () => ({ tools: TOOLS }) })
  .register('tools/call', { handle: callTool })
  .register('resources/list', { handle: resourceListResult })
  .register('resources/templates/list', { handle: resourceTemplateListResult })
  .register('resources/read', { handle: readResource })
  .register('prompts/list', { handle: promptListResult })
  .register('prompts/get', { handle: promptResult });

/**
 * Handle one JSON-RPC message, or answer null for a notification.
 * @param user - Who the request is from.
 * @param message - The message, untrusted.
 * @param runTool - What runs a tool call; a test passes its own.
 * @param services - What this app's tools reach for; a test passes fakes.
 */
export async function handleMcpMessage(
  user: Readonly<User>,
  message: Parameters<typeof server.handleMessage>[0],
  runTool: ToolRunner = callToolOrExplain,
  services?: ToolServices,
): Promise<JsonRpcResponse | null> {
  return server.handleMessage(message, {
    tools: toolContext(user, services),
    runTool,
  });
}
