/**
 * @packageDocumentation
 *
 * How this server names itself to assistants: its identity in the `initialize`
 * reply, where that identity is carried in a result's `_meta`, and what it
 * tells an assistant about itself when it connects.
 *
 * It sits apart from `app.ts` because `app.ts` answers what the app lets a
 * caller do — its scopes and its own failures — while this is only who the
 * server says it is.
 */

import { BRAND_NAME } from '@/app/_brand';

/** How this server names itself in the `initialize` reply. */
export interface ServerInfo {
  readonly name: string;
  readonly title: string;
  readonly version: string;
}

/**
 * Where the server's identity is carried in a result's `_meta`, which the
 * newest protocol revision asks for.
 */
export const SERVER_INFO_META_KEY = 'io.modelcontextprotocol/serverInfo';

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
