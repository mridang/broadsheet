/**
 * @packageDocumentation
 *
 * How the MCP server names itself to assistants, and what it tells them.
 */

import { BRAND_NAME } from '@/app/_brand';
import { ToolFailureError } from '@/domain/mcp/tool-failure';

/**
 * May look at the feeds, the paper and the archive, and never change them.
 *
 * The two scope names are the ones grants already carry, so an assistant that
 * was approved before keeps working.
 */
export const SCOPE_READ = 'read';
/** May follow, save and train as well as look (implies read). */
export const SCOPE_WRITE = 'write';

/** What each scope lets the app do, in plain words, for the approval screen. */
export const SCOPE_TEXT: Readonly<Record<string, string>> = {
  [SCOPE_READ]: 'See your feeds, your paper and your archive',
  [SCOPE_WRITE]:
    'Follow and unfollow feeds, save and read stories, and train what you are shown',
};

/**
 * What a read-only connection may still do, in a few words, for the approval
 * screen's choice to allow less than the app asked for.
 */
export const READ_ONLY_TEXT = 'read your paper and your archive';

/** The scopes this app offers. */
export const SUPPORTED_SCOPES = [SCOPE_READ, SCOPE_WRITE] as const;

/**
 * The failures of this app's own making that an assistant can act on, as the
 * words to tell it, or undefined when the failure is not one of them.
 *
 * A tool that cannot do what was asked raises a `ToolFailureError`, which is
 * answered where the tool ran, so nothing is left for this to recognise.
 */
export function explainFailure(_error: unknown): string | undefined {
  return undefined;
}

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

export { BRAND_NAME as RESOURCE_NAME } from '@/app/_brand';
