/**
 * @packageDocumentation
 *
 * Ready-made requests an assistant can offer the person: each is a short
 * instruction naming the tools that do the work.
 */

import type { McpPrompt } from '@/lib/mcp';

/** Every prompt. */
export const PROMPTS: readonly McpPrompt[] = [
  {
    name: 'daily_briefing',
    title: 'Daily briefing',
    description: "Summarise today's paper.",
    arguments: [],
    render: () =>
      "Call get_briefing for today's issue and read_paper for its stories. Summarise the most important stories by section in a few short paragraphs, naming each story's source.",
  },
  {
    name: 'triage_unread',
    title: 'Triage unread stories',
    description:
      'Go through unread stories and suggest what to read, save or skip.',
    arguments: [
      {
        name: 'feed_id',
        description: 'Only this feed (from list_feeds).',
      },
    ],
    render: ({ feed_id }) =>
      `Call search_articles with an empty query and read_filter "unread"${feed_id ? ` and feed_id ${feed_id}` : ''}. Sort the stories into read now, save for later (save_article with a tag) and skip, and ask before marking anything read with mark_read.`,
  },
  {
    name: 'research_topic',
    title: 'Research a topic',
    description: 'Gather what the archive says about a topic.',
    arguments: [
      { name: 'topic', description: 'What to research.', required: true },
    ],
    render: ({ topic }) =>
      `Use search_articles to find stories about "${topic}", get_article for the most relevant few, and ask_archive for a cited answer. Write a short summary that links each claim to its article.`,
  },
  {
    name: 'train_from_reading',
    title: 'Train from reading',
    description:
      'Suggest likes and dislikes from what the person reads and saves.',
    arguments: [],
    render: () =>
      'Compare list_saved and the stories search_articles returns with read_filter "read" against list_classifiers. Suggest a few authors, sources or title words to like or dislike, and add them with add_classifier only once the person agrees.',
  },
  {
    name: 'feed_health_check',
    title: 'Feed health check',
    description: 'Find feeds that are failing or have gone quiet.',
    arguments: [],
    render: () =>
      'Call list_feeds, then get_feed for each one. Report feeds with fetch failures or no recent stories, and suggest unfollowing or replacing them. Change nothing without asking.',
  },
  {
    name: 'discover_new_feeds',
    title: 'Discover new feeds',
    description: 'Suggest feeds to follow.',
    arguments: [
      { name: 'interests', description: 'What the person is interested in.' },
    ],
    render: ({ interests }) =>
      `Call discover_feeds and list_feeds${interests ? `, keeping to these interests: ${interests}` : ''}. Suggest a handful of feeds the person does not follow yet, and follow one with follow_feed only when asked.`,
  },
];
