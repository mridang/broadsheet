/**
 * @packageDocumentation
 *
 * What this app's tools answer with. The shapes and the builders are the
 * library's, re-exported here so a tool reaches for them in one place and an
 * app that grows result builders of its own has somewhere to put them.
 */

export {
  dataResult,
  errorResult,
  type TextContent,
  textResult,
  type ToolResult,
} from '@/lib/mcp';
