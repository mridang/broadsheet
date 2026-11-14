/**
 * @packageDocumentation
 *
 * The resources the MCP server offers: read-only JSON views of the caller's
 * own feeds, sections, saved tags, training and profile, for an assistant to
 * attach as context. Each is scoped to `ctx.uid`.
 */

import { classifierResource } from '@/domain/api/classifier-resource';
import { feedResource } from '@/domain/api/feed-resource';
import { sectionResource } from '@/domain/api/section-resource';
import { Repository } from '@/domain/repository';
import { ToolFailureError, type McpResource } from '@/lib/mcp';
import type { ToolContext } from './tool-context';
import { compareText } from '@/lib/intl';

/** The URI of one feed. */
const FEED_URI = /^broadsheet:\/\/feeds\/([1-9]\d{0,15})$/;

/** Every resource, fixed ones first. */
export const RESOURCES: readonly McpResource<ToolContext>[] = [
  {
    name: 'feeds',
    uri: 'broadsheet://feeds',
    description: 'The feeds the person follows.',
    read: async (_params, { uid, db }) => {
      const feeds = await new Repository(db).listFeeds(uid);
      return { feeds: feeds.map((feed) => feedResource(feed)) };
    },
  },
  {
    name: 'sections',
    uri: 'broadsheet://sections',
    description: 'The sections the person groups feeds under.',
    read: async (_params, { uid, db }) => {
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
    read: async (_params, { uid, db }) => {
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
    read: async (_params, { uid, db }) => {
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
    read: async (_params, { uid, db }) => {
      const user = await new Repository(db).getUser(uid);
      if (!user) throw new ToolFailureError('There is no such account.');
      return { email: user.email, ...(user.name ? { name: user.name } : {}) };
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
    read: async ({ feed_id }, { uid, db }) => {
      const feed = await new Repository(db).getFeed(uid, Number(feed_id));
      if (!feed) throw new ToolFailureError('There is no such feed.');
      return feedResource(feed);
    },
  },
];
