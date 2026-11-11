/**
 * @packageDocumentation
 *
 * The tools the archive assistant may call, after NewsBlur's: search the
 * archive (with a date range and a source), search the saved stories (by tag,
 * with their notes and highlights) and summarise them, search what readers
 * shared (with their comments), list what was read recently, read one story in
 * full, and get a summary of what the archive holds. Each runs as the person through the
 * {@link Repository}, so it only ever sees their followed sources, saves and
 * reads. A {@link ToolRunner} remembers every story it handed the model, so an
 * answer can cite only those.
 */

import {
  archivePrompt,
  citedIds,
  converse,
  passageBlock,
  storyBlock,
  type AnswerModel,
  type ToolCall,
  type ToolDefinition,
} from '@/domain/assistant';
import type { Message, Passage, Repository } from '@/domain/repository';

/** Most stories one search returns. */
const MAX_RESULTS = 20;

/** Characters of a story's text `get_story` returns. */
const STORY_LENGTH = 8000;

/** A day as the tools take one. */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A JSON Schema property: a string, with a description. */
const text = (description: string) => ({ type: 'string', description });

/** A JSON Schema property: a whole number, with a description. */
const whole = (description: string) => ({ type: 'integer', description });

/** Every tool the assistant is offered. */
export const ASSISTANT_TOOLS: readonly ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'search_stories',
      description:
        "Full-text search of the reader's archive: stories from the feeds they follow, their saves and their reads. Returns matching stories with ids, dates and excerpts.",
      parameters: {
        type: 'object',
        properties: {
          query: text('Words to look for in titles, summaries and text.'),
          since: text('Only stories from this day on (YYYY-MM-DD).'),
          until: text('Only stories up to this day (YYYY-MM-DD).'),
          source: text('Only stories whose source name or address holds this.'),
          limit: whole(`How many stories (default 8, at most ${MAX_RESULTS}).`),
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_saved_stories',
      description:
        'Search the stories the reader saved, newest save first, optionally only those with one of their tags.',
      parameters: {
        type: 'object',
        properties: {
          query: text('Words to look for; leave out to list saves.'),
          tag: text('Only saves the reader tagged with this.'),
          limit: whole(
            `How many stories (default 10, at most ${MAX_RESULTS}).`,
          ),
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'saved_summary',
      description:
        "An overview of the reader's saves: how many, their tags, the sources they save most and their newest saves. Use before searching saves.",
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_shared_stories',
      description:
        'Search the stories readers shared, with who shared each and their comment. Use to find what other people are recommending or discussing.',
      parameters: {
        type: 'object',
        properties: {
          query: text(
            'Words to look for; leave out to list the newest shares.',
          ),
          limit: whole(
            `How many stories (default 10, at most ${MAX_RESULTS}).`,
          ),
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'recent_reads',
      description:
        'The stories the reader opened recently, newest first. Use for questions about what they read lately.',
      parameters: {
        type: 'object',
        properties: {
          days: whole('How many days back (default 7, at most 90).'),
          limit: whole(
            `How many stories (default 10, at most ${MAX_RESULTS}).`,
          ),
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_story',
      description:
        'The full text of one story by its id, when an excerpt is not enough.',
      parameters: {
        type: 'object',
        properties: { id: whole('The story id from a search.') },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'archive_summary',
      description:
        "An overview of the reader's archive: how many feeds, stories, saves and reads, their most-read sources and most-used tags.",
      parameters: { type: 'object', properties: {} },
    },
  },
];

/** A string argument, or undefined. */
function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** A whole-number argument clamped to 1..`max`, or `fallback`. */
function count(value: unknown, fallback: number, max: number): number {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n)
    ? Math.min(Math.max(n, 1), max)
    : fallback;
}

/** A day argument, or undefined when it is not YYYY-MM-DD. */
function day(value: unknown): string | undefined {
  const s = str(value);
  return s && DAY.test(s) ? s : undefined;
}

/** Answers the assistant's tool calls as one person, remembering what it showed. */
export class ToolRunner {
  readonly #repo: Repository;
  readonly #uid: number;
  readonly #seen = new Map<number, string | null>();

  constructor(repo: Repository, uid: number) {
    this.#repo = repo;
    this.#uid = uid;
  }

  /** Every story handed to the model so far, by id, with its title. */
  get seen(): ReadonlyMap<number, string | null> {
    return this.#seen;
  }

  /** Note stories as shown, and set them out for the model. */
  show(passages: readonly Passage[]): string {
    for (const p of passages) this.#seen.set(p.id, p.title);
    return passages.length > 0
      ? passages.map((passage) => passageBlock(passage)).join('\n\n')
      : 'No stories found.';
  }

  /** Answer one call; an unknown tool or a bad argument is told so, never thrown. */
  async run(call: ToolCall): Promise<string> {
    const args = call.arguments;
    switch (call.name) {
      case 'search_stories': {
        const query = str(args['query']);
        if (!query) return 'search_stories needs a query.';
        return this.show(
          await this.#repo.retrievePassages(this.#uid, query, {
            since: day(args['since']),
            until: day(args['until']),
            source: str(args['source']),
            limit: count(args['limit'], 8, MAX_RESULTS),
          }),
        );
      }
      case 'search_saved_stories': {
        return this.show(
          await this.#repo.savedPassages(this.#uid, {
            query: str(args['query']),
            tag: str(args['tag']),
            limit: count(args['limit'], 10, MAX_RESULTS),
          }),
        );
      }
      case 'saved_summary': {
        const summary = await this.#repo.savedSummary(this.#uid);
        for (const r of summary.recent) this.#seen.set(r.id, r.title);
        return JSON.stringify(summary);
      }
      case 'search_shared_stories': {
        return this.show(
          await this.#repo.sharedPassages({
            query: str(args['query']),
            limit: count(args['limit'], 10, MAX_RESULTS),
          }),
        );
      }
      case 'recent_reads': {
        return this.show(
          await this.#repo.recentReadPassages(
            this.#uid,
            count(args['days'], 7, 90),
            count(args['limit'], 10, MAX_RESULTS),
          ),
        );
      }
      case 'get_story': {
        const id = count(args['id'], 0, Number.MAX_SAFE_INTEGER);
        const article = id
          ? await this.#repo.reachableArticle(this.#uid, id)
          : undefined;
        if (!article) return `No story with id ${String(args['id'])}.`;
        this.#seen.set(article.id, article.title);
        const annotation = await this.#repo.saveAnnotation(
          this.#uid,
          article.id,
        );
        const annotationLine = annotation ? `\n${annotation}` : '';
        return storyBlock(
          `id="${article.id}"`,
          `${article.title ?? ''} (${article.source ?? ''})\n${article.summary ?? ''}\n${(article.body_text ?? '').slice(0, STORY_LENGTH)}${annotationLine}`,
        );
      }
      case 'archive_summary': {
        return JSON.stringify(await this.#repo.archiveSummary(this.#uid));
      }
      default: {
        return `There is no tool called ${call.name}.`;
      }
    }
  }
}

/** A turn the assistant answered: the reply as kept, and the titles of what it was shown. */
export interface AnsweredTurn {
  readonly reply: Message;
  readonly titles: ReadonlyMap<number, string | null>;
}

/**
 * Answer one question in a conversation: find passages for it, let the model
 * search further with {@link ASSISTANT_TOOLS}, note the question against the
 * person's budget, and keep the question and the answer (citing only stories
 * it was shown) as turns, titling the conversation by its first question.
 * Throws {@link AnswerUnavailable} when the model fails, keeping nothing.
 */
export async function answerTurn(
  repo: Repository,
  uid: number,
  conversationId: number,
  question: string,
  model: AnswerModel | undefined,
  today: string = new Date().toISOString().slice(0, 10),
): Promise<AnsweredTurn> {
  const tools = new ToolRunner(repo, uid);
  const history = await repo.listMessages(conversationId);
  const passages = await repo.retrievePassages(uid, question);
  tools.show(passages);
  const answer = await converse(
    model,
    archivePrompt(passages, history, question, today),
    ASSISTANT_TOOLS,
    (call) => tools.run(call),
  );
  await repo.recordUsage(uid, 'assistant');
  await repo.addMessage(conversationId, 'user', question);
  const reply = await repo.addMessage(
    conversationId,
    'assistant',
    answer,
    citedIds(answer, new Set(tools.seen.keys())),
  );
  await repo.touchConversation(conversationId, question);
  return { reply, titles: tools.seen };
}
