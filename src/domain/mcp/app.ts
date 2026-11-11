/**
 * @packageDocumentation
 *
 * How the MCP server names itself to assistants, and what it tells them.
 */

import { BRAND_NAME } from '@/app/_brand';
import type { ServerInfo } from '@/lib/mcp';

/** The name the protected resource metadata gives the MCP server. */

/** The server's identity in the `initialize` reply. */
export const SERVER_INFO: ServerInfo = {
  name: 'broadsheet',
  title: BRAND_NAME,
  version: '1.0.0',
};

/** What the server tells an assistant about itself when it connects. */
export const INSTRUCTIONS = [
  `${BRAND_NAME} turns the feeds a person follows into a daily newspaper.`,
  'Use read_paper for today’s edition, search_articles to look through the archive,',
  'and get_article for one story’s full text. Feeds, saves and training change',
  'what the person sees, so only change them when asked.',
].join(' ');

export { BRAND_NAME as RESOURCE_NAME } from '@/app/_brand';
