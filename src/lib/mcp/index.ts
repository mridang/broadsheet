/**
 * @packageDocumentation
 *
 * Public surface of the lib/mcp package.
 *
 * The tool half is the reusable library the other apps share: an app brings its
 * tools, each a class extending {@link McpTool}, and says which scopes it offers
 * and which of its own failures are worth explaining. The transport half, the
 * JSON-RPC engine and its protocol, is this app's own for now.
 */
export {
  type AnyMcpTool,
  type ArgumentSpellings,
  McpTool,
  READS,
  READS_THE_WEB,
  type ToolAnnotations,
  type ToolArgs,
  type WriteEffects,
  writes,
} from './tool';
export { type NameOf, ToolRegistry } from './registry';
export {
  type AdvertisedAnnotations,
  type AdvertisedTool,
  type SecurityScheme,
  ToolCatalogue,
} from './catalogue';
export { ReadWriteScopes, type ScopePolicy } from './scopes';
export { ArgumentChecker, type CheckedArguments } from './arguments';
export { type FailureExplainer, NoExplanations } from './failures';
export {
  type FailureLog,
  ToolInvoker,
  type ToolInvokerOptions,
} from './invoker';
export {
  dataResult,
  errorResult,
  type JsonContent,
  type TextContent,
  textResult,
  type ToolResult,
} from './results';
export {
  ANNOTATION_KEYWORDS,
  CHECKED_KEYWORDS,
  describeArguments,
  isJsonObject,
  type JsonSchema,
  type JsonType,
  NOT_BLANK,
  PROBLEMS_SHOWN,
  unsupportedKeywords,
  validateJson,
} from './json-schema';
export {
  canonicalArguments,
  limitArg,
  numberArg,
  offsetArg,
  stringArg,
  stringListArg,
  textArg,
} from './tool-args';
export {
  BackendFailureError,
  InvalidToolArgumentsError,
  UnknownToolError,
} from './tool-errors';
export {
  ERROR_INTERNAL,
  ERROR_INVALID_PARAMS,
  ERROR_INVALID_REQUEST,
  ERROR_METHOD_NOT_FOUND,
  ERROR_PARSE,
  errorReply,
  isJsonRpcMessage,
  isNotification,
  isPlainObject,
  type JsonRpcMessage,
  type JsonRpcResponse,
  negotiateVersion,
  type ReplyId,
  replyIdOf,
  RESOURCE_NOT_FOUND,
  RpcError,
  SUPPORTED_VERSIONS,
} from './protocol';
export {
  type McpPrompt,
  type McpResource,
  McpServer,
  type ServerInfo,
  ToolFailureError,
} from './server';
