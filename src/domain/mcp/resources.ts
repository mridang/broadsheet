/**
 * @packageDocumentation
 *
 * The resources the MCP server offers: read-only JSON views of the caller's
 * own feeds, sections, saved tags, training and profile, for an assistant to
 * attach as context. Each is scoped to `ctx.user.id`.
 */

import { classifierResource } from '@/domain/api/classifier-resource';
import { feedResource } from '@/domain/api/feed-resource';
import { sectionResource } from '@/domain/api/section-resource';
import { Repository } from '@/domain/repository';
import { ToolFailureError } from '@/domain/mcp/tool-failure';
import type { ToolContext } from './tool-context';
import { compareText } from '@/lib/intl';

/** The URI of one feed. */
const FEED_URI = /^broadsheet:\/\/feeds\/([1-9]\d{0,15})$/;

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

/** Every resource, fixed ones first. */
export const RESOURCES: readonly McpResource<ToolContext>[] = [
  {
    name: 'feeds',
    uri: 'broadsheet://feeds',
    description: 'The feeds the person follows.',
    read: async (_params, { user, services }) => {
      const db = services.openDatabase();
      const uid = user.id;
      const feeds = await new Repository(db).listFeeds(uid);
      return { feeds: feeds.map((feed) => feedResource(feed)) };
    },
  },
  {
    name: 'sections',
    uri: 'broadsheet://sections',
    description: 'The sections the person groups feeds under.',
    read: async (_params, { user, services }) => {
      const db = services.openDatabase();
      const uid = user.id;
      const sections = await new Repository(db).listSections(uid);
      return {
        sections: sections.map((section) => sectionResource(section)),
      };
    },
  },
  {
    name: 'saved-tags',
    uri: 'broadsheet://saved/tags',
    description: 'Every tag on the person’s saved stories, with how many.',
    read: async (_params, { user, services }) => {
      const db = services.openDatabase();
      const uid = user.id;
      const counts = new Map<string, number>();
      for (const save of await new Repository(db).listSaves(uid)) {
        for (const tag of save.tags)
          counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
      return {
        tags: [...counts]
          .toSorted(([a], [b]) => compareText(a, b))
          .map(([tag, count]) => ({ tag, count })),
      };
    },
  },
  {
    name: 'classifiers',
    uri: 'broadsheet://classifiers',
    description: 'The likes and dislikes the person trained the paper with.',
    read: async (_params, { user, services }) => {
      const db = services.openDatabase();
      const uid = user.id;
      const classifiers = await new Repository(db).listClassifiers(uid);
      return {
        classifiers: classifiers.map((classifier) =>
          classifierResource(classifier),
        ),
      };
    },
  },
  {
    name: 'profile',
    uri: 'broadsheet://profile',
    description: 'Who the person is.',
    read: async (_params, { user, services }) => {
      const db = services.openDatabase();
      const uid = user.id;
      const account = await new Repository(db).getUser(uid);
      if (!account) throw new ToolFailureError('There is no such account.');
      return {
        email: account.email,
        ...(account.name ? { name: account.name } : {}),
      };
    },
  },
  {
    name: 'feed',
    uriTemplate: 'broadsheet://feeds/{feed_id}',
    description: 'One followed feed with its details and full header.',
    match: (uri) => {
      const id = FEED_URI.exec(uri)?.[1];
      return id ? { feed_id: id } : undefined;
    },
    read: async ({ feed_id }, { user, services }) => {
      const db = services.openDatabase();
      const uid = user.id;
      const feed = await new Repository(db).getFeed(uid, Number(feed_id));
      if (!feed) throw new ToolFailureError('There is no such feed.');
      return feedResource(feed);
    },
  },
];
