/**
 * @packageDocumentation
 *
 * Public surface of the lib/mcp package: a reusable MCP server library.
 *
 * An app brings its tools, each a class extending {@link McpTool}, and says
 * which scopes it offers and which of its own failures are worth explaining.
 * Everything else — the protocol, the catalogue, the argument checking and the
 * call path — is here and is the same in every app that uses it.
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
  type JsonSchema,
  type JsonType,
  isJsonObject,
  NOT_BLANK,
  PROBLEMS_SHOWN,
  unsupportedKeywords,
  validateJson,
} from './json-schema';
export {
  ERROR_HEADER_MISMATCH,
  ERROR_INTERNAL,
  ERROR_INVALID_PARAMS,
  ERROR_INVALID_REQUEST,
  ERROR_METHOD_NOT_FOUND,
  ERROR_PARSE,
  ERROR_UNSUPPORTED_VERSION,
  LEGACY_VERSIONS,
  MODERN_VERSION,
  type ParsedMessage,
  type ProtocolMessage,
  type ProtocolRefusal,
  type RefusalSpec,
  type ReplyId,
  RpcError,
  SUPPORTED_VERSIONS,
  checkBatch,
  checkRequestHeaders,
  declaredVersion,
  decodeHeaderValue,
  errorBody,
  headerVersion,
  isAllowedOrigin,
  isModernRequest,
  isNotification,
  isPlainObject,
  negotiateLegacyVersion,
  parseAllowedOrigins,
  parseMessage,
  protocolRefusal,
  replyIdOf,
  withoutId,
} from './protocol';
export {
  type CacheHint,
  type JsonRpcErrorBody,
  type JsonRpcMessage,
  type JsonRpcResponse,
  type McpMethod,
  McpServer,
  type McpServerOptions,
} from './server';
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
