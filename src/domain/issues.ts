/**
 * @packageDocumentation
 *
 * A person's daily issue: their feeds laid out for one edition, with an
 * editor's note on the top stories written by Workers AI. The daily Workflow
 * stores one per reader, and the paper reads the stored issue back, laying a
 * day out live only when none was stored.
 */
import type { Database } from '@/domain/db/database';
import {
  Repository,
  type Article,
  type CustomEdition,
  sectionAndDescendants,
  sectionPath,
} from '@/domain/repository';
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
 * What a custom edition prints: the feeds of some sections (all of them when
 * `sectionIds` is empty) and, with `keep`, only the stories it accepts.
 */
export interface IssuePick {
  readonly sectionIds: readonly number[];
  readonly keep?: (articleId: number) => boolean;
}

/**
 * Lay out `ownerId`'s paper for `date`. With a `readerId`, their training
 * orders it and the stories they read in other editions are left out. Muted
 * feeds stay out; feeds filed under a section print under its heading. A
 * `pick` narrows it to a custom edition's stories.
 */
export async function composeLayout(
  repo: Repository,
  ownerId: number,
  date: string,
  readerId?: number,
  pick?: IssuePick,
): Promise<Layout> {
  const [all, reads, training, sections] = await Promise.all([
    repo.listFeeds(ownerId),
    readerId === undefined ? undefined : repo.readState(readerId),
    readerId === undefined ? [] : repo.listClassifiers(readerId),
    repo.listSections(ownerId),
  ]);
  // A picked section takes in the sections nested under it.
  const picked = new Set(
    (pick?.sectionIds ?? []).flatMap((id) => [
      ...sectionAndDescendants(sections, id),
    ]),
  );
  const feeds = all.filter(
    (f) =>
      !f.muted &&
      (!picked.size || (f.section_id !== null && picked.has(f.section_id))),
  );
  const desks = await Promise.all(
    feeds.map(async (feed) => ({
      feed,
      articles: (await repo.sourceArticles(feed.source_id, date)).filter(
        (a) =>
          (!reads || reads.ids.has(a.id) || !reads.urls.has(a.url)) &&
          (!pick?.keep || pick.keep(a.id)),
      ),
    })),
  );
  const groups: DeskGroup[] = [
    { id: null, name: null },
    ...sections.map((s) => ({ id: s.id, name: sectionPath(sections, s.id) })),
  ]
    .map((group) => ({
      name: group.name,
      desks: desks.filter(({ feed }) =>
        group.id === null
          ? !sections.some((s) => s.id === feed.section_id)
          : feed.section_id === group.id,
      ),
    }))
    .map((group) => ({
      ...group,
      desks: group.desks.filter((desk) => desk.articles.length || !pick?.keep),
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

/** Lay out the editor's note on a layout's top stories. */
async function briefingFor(
  repo: Repository,
  env: CloudflareEnv,
  layout: Layout,
): Promise<{ readonly briefing: string | null; readonly stories: number }> {
  const byId = await issueArticles(repo, layout);
  const top = topStories(layout, BRIEFED).flatMap((id) => {
    const a = byId.get(id);
    return a ? [a] : [];
  });
  return { briefing: await writeBriefing(env, top), stories: byId.size };
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
  const { briefing, stories } = await briefingFor(repo, env, layout);
  await repo.saveIssue(userId, date, JSON.stringify(layout), briefing);
  return stories;
}

/**
 * What a custom edition's rules pick on `date`: its sections, and the stories
 * that match its search and are saved under its tag.
 */
export async function editionPick(
  repo: Repository,
  edition: CustomEdition,
  date: string,
): Promise<IssuePick> {
  const sets = await Promise.all([
    edition.query ? repo.matchingArticleIds(date, edition.query) : undefined,
    edition.tag
      ? repo.taggedArticleIds(edition.user_id, edition.tag)
      : undefined,
  ]);
  const filters = sets.filter((set): set is Set<number> => set !== undefined);
  return {
    sectionIds: edition.section_ids,
    ...(filters.length
      ? { keep: (id: number) => filters.every((set) => set.has(id)) }
      : {}),
  };
}

/**
 * Lay out and store a custom edition's issue for `date`, as
 * {@link publishIssue} does for the default one. Returns how many stories it
 * prints.
 */
export async function publishEditionIssue(
  db: Database,
  env: CloudflareEnv,
  edition: CustomEdition,
  date: string,
): Promise<number> {
  const repo = new Repository(db);
  const layout = await composeLayout(
    repo,
    edition.user_id,
    date,
    edition.user_id,
    await editionPick(repo, edition, date),
  );
  const { briefing, stories } = await briefingFor(repo, env, layout);
  await repo.saveEditionIssue(
    edition.id,
    date,
    JSON.stringify(layout),
    briefing,
  );
  return stories;
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

/** A custom edition's stored issue for `date`, if one was laid out. */
export async function storedEditionIssue(
  repo: Repository,
  editionId: number,
  date: string,
): Promise<Issue | undefined> {
  const row = await repo.getEditionIssue(editionId, date);
  const layout = row ? parseLayout(row.layout) : undefined;
  return row && layout
    ? { date, layout, briefing: row.briefing, created_at: row.created_at }
    : undefined;
}

/**
 * A custom edition's paper for `date`: the stored issue when there is one,
 * else the day laid out live by its rules (with no editor's note).
 */
export async function editionIssueFor(
  repo: Repository,
  edition: CustomEdition,
  date: string,
): Promise<Issue> {
  return (
    (await storedEditionIssue(repo, edition.id, date)) ?? {
      date,
      layout: await composeLayout(
        repo,
        edition.user_id,
        date,
        edition.user_id,
        await editionPick(repo, edition, date),
      ),
      briefing: null,
      created_at: null,
    }
  );
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
