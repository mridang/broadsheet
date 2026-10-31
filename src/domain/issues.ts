/**
 * @packageDocumentation
 *
 * A person's daily issue: their feeds laid out for one edition, with an
 * editor's note on the top stories written by Workers AI. The daily Workflow
 * stores one per reader, and the paper reads the stored issue back, laying a
 * day out live only when none was stored.
 */
import type { Database } from '@/domain/db/database';
import { Repository, type Article } from '@/domain/repository';
import {
  layOut,
  parseLayout,
  storyIds,
  topStories,
  type DeskGroup,
  type Layout,
} from '@/domain/render/layout';
import { logWarn } from '@/utils/logging';

/** The model the editor's note is written with. */
export const BRIEFING_MODEL = '@cf/meta/llama-3.1-8b-instruct-fast';

/** How many top stories the note covers, and its longest length. */
const BRIEFED = 6;
const MAX_BRIEFING = 600;

/** One day's paper: its layout and, when one was written, the note. */
export interface Issue {
  readonly date: string;
  readonly layout: Layout;
  readonly briefing: string | null;
  /** When it was stored; null for a paper laid out live. */
  readonly created_at: string | null;
}

/**
 * Lay out `ownerId`'s paper for `date`. With a `readerId`, their training
 * orders it and the stories they read in other editions are left out. Muted
 * feeds stay out; feeds filed under a section print under its heading.
 */
export async function composeLayout(
  repo: Repository,
  ownerId: number,
  date: string,
  readerId?: number,
): Promise<Layout> {
  const feeds = (await repo.listFeeds(ownerId)).filter((f) => !f.muted);
  const [reads, training, sections] = await Promise.all([
    readerId === undefined ? undefined : repo.readState(readerId),
    readerId === undefined ? [] : repo.listClassifiers(readerId),
    repo.listSections(ownerId),
  ]);
  const desks = await Promise.all(
    feeds.map(async (feed) => ({
      feed,
      articles: (await repo.sourceArticles(feed.source_id, date)).filter(
        (a) => !reads || reads.ids.has(a.id) || !reads.urls.has(a.url),
      ),
    })),
  );
  const groups: DeskGroup[] = [
    { id: null, name: null },
    ...sections.map((s) => ({ id: s.id, name: s.name })),
  ]
    .map((group) => ({
      name: group.name,
      desks: desks.filter(({ feed }) =>
        group.id === null
          ? !sections.some((s) => s.id === feed.section_id)
          : feed.section_id === group.id,
      ),
    }))
    .filter((group) => group.desks.length);
  return layOut(groups, training);
}

/** The prompt that asks for an editor's note on these stories. */
export function briefingPrompt(stories: readonly Article[]): string {
  return (
    "Write a short editor's note (two or three sentences, under 80 words) for " +
    "the front page of today's paper, summarising these top stories. Reply " +
    'with the note only, no heading or quotes.\n\n' +
    stories
      .map(
        (a) =>
          `- ${a.title ?? ''}${a.summary ? `: ${a.summary.slice(0, 200)}` : ''}`,
      )
      .join('\n')
  );
}

/** Ask Workers AI for the editor's note, or null when it gives none. */
export async function writeBriefing(
  env: CloudflareEnv,
  stories: readonly Article[],
): Promise<string | null> {
  if (!stories.length) return null;
  try {
    const out = await env.AI.run(BRIEFING_MODEL, {
      messages: [{ role: 'user', content: briefingPrompt(stories) }],
    });
    const text = (out as { response?: unknown }).response;
    const note = typeof text === 'string' ? text.trim() : '';
    return note ? note.slice(0, MAX_BRIEFING) : null;
  } catch (error) {
    logWarn({
      event: 'briefing.failed',
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** The articles a layout prints, by id. */
export async function issueArticles(
  repo: Repository,
  layout: Layout,
): Promise<Map<number, Article>> {
  const rows = await repo.articlesByIds(storyIds(layout));
  return new Map(rows.map((a) => [a.id, a]));
}

/**
 * Lay out and store a person's issue for `date`, with an editor's note on its
 * top stories. Returns how many stories it prints.
 */
export async function publishIssue(
  db: Database,
  env: CloudflareEnv,
  userId: number,
  date: string,
): Promise<number> {
  const repo = new Repository(db);
  const layout = await composeLayout(repo, userId, date, userId);
  const byId = await issueArticles(repo, layout);
  const top = topStories(layout, BRIEFED).flatMap((id) => {
    const a = byId.get(id);
    return a ? [a] : [];
  });
  const briefing = await writeBriefing(env, top);
  await repo.saveIssue(userId, date, JSON.stringify(layout), briefing);
  return byId.size;
}

/** A person's stored issue for `date`, if one was laid out and still reads. */
export async function storedIssue(
  repo: Repository,
  userId: number,
  date: string,
): Promise<Issue | undefined> {
  const row = await repo.getIssue(userId, date);
  const layout = row ? parseLayout(row.layout) : undefined;
  return row && layout
    ? { date, layout, briefing: row.briefing, created_at: row.created_at }
    : undefined;
}

/**
 * `ownerId`'s paper for `date`: the stored issue when there is one, else the
 * day laid out live (with no editor's note).
 */
export async function issueFor(
  repo: Repository,
  ownerId: number,
  date: string,
  readerId?: number,
): Promise<Issue> {
  return (
    (await storedIssue(repo, ownerId, date)) ?? {
      date,
      layout: await composeLayout(repo, ownerId, date, readerId),
      briefing: null,
      created_at: null,
    }
  );
}

/** Whether `date` is a calendar date written YYYY-MM-DD. */
export function isIssueDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const ms = Date.parse(`${date}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().startsWith(date);
}
