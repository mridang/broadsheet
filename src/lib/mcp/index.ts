/**
 * @packageDocumentation
 *
 * Public surface of the lib/mcp package.
 */
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
  type McpTool,
  type ServerInfo,
  tool,
  ToolFailureError,
} from './server';
