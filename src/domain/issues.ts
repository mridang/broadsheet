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
  type Preferences,
  autoMarkReadDays,
  filedIn,
  sectionAndDescendants,
  sectionPath,
} from '@/domain/repository';
import {
  parseBriefedStories,
  selectStories,
  writeBriefing,
  type BriefedStory,
  type Candidate,
} from '@/domain/briefing';
import { toCandidates } from '@/domain/briefings';
import { scorePrompts } from '@/domain/prompts';
import {
  layOut,
  parseLayout,
  storyIds,
  type DeskGroup,
  type Layout,
} from '@/domain/render/layout';

/** One day's paper: its layout and, when one was written, the note. */
export interface Issue {
  readonly date: string;
  readonly layout: Layout;
  readonly briefing: string | null;
  /** The stories the note covers and why each was picked. */
  readonly briefing_stories: readonly BriefedStory[];
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
 * orders it, the stories they read in other editions are left out, and so
 * are editions older than their auto-mark-read days. Muted
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
  const [all, reads, training, sections, prefs, prompted] = await Promise.all([
    repo.listFeeds(ownerId),
    readerId === undefined ? undefined : repo.readState(readerId),
    readerId === undefined ? [] : repo.listClassifiers(readerId),
    repo.listSections(ownerId),
    repo.getPreferences(readerId ?? ownerId),
    readerId === undefined ? new Map() : repo.promptMatches(readerId),
  ]);
  // A picked section takes in the sections nested under it.
  const picked = new Set(
    (pick?.sectionIds ?? []).flatMap((id) => [
      ...sectionAndDescendants(sections, id),
    ]),
  );
  const feeds = all.filter(
    (f) => !f.muted && (!picked.size || filedIn(f, picked)),
  );
  const desks = await Promise.all(
    feeds.map(async (feed) => {
      // For a reader, a feed or section (else their own setting) that marks
      // stories read after some days leaves out the editions older than that.
      const days =
        readerId === undefined
          ? undefined
          : autoMarkReadDays(feed, sections, prefs.auto_mark_read_days);
      const oldest =
        days === undefined
          ? undefined
          : new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
      return {
        feed,
        articles: (await repo.sourceArticles(feed.source_id, date))
          .filter(
            (a) =>
              (!reads || reads.ids.has(a.id) || !reads.urls.has(a.url)) &&
              (!oldest || !a.edition || a.edition >= oldest) &&
              (!pick?.keep || pick.keep(a.id)),
          )
          // The reader's AI prompts this story matched, for `verdict`.
          .map((a) => {
            const ids = prompted.get(a.id);
            return ids ? { ...a, prompt_ids: ids } : a;
          }),
      };
    }),
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
  // The copies of the paper's stories it does not print: from other days
  // within the lookback, or desks left out.
  const clusterIds = desks.flatMap(({ articles }) =>
    articles.flatMap((a) => (a.cluster_id === null ? [] : [a.cluster_id])),
  );
  const outside =
    prefs.story_clustering && clusterIds.length
      ? await repo.clusterMembers(readerId ?? ownerId, clusterIds)
      : [];
  return layOut(
    groups,
    training,
    { clustering: prefs.story_clustering, mode: prefs.cluster_mode },
    outside,
  );
}

/** The articles a layout prints, by id. */
export async function issueArticles(
  repo: Repository,
  layout: Layout,
): Promise<Map<number, Article>> {
  const rows = await repo.articlesByIds(storyIds(layout));
  return new Map(rows.map((a) => [a.id, a]));
}

/** The day before a YYYY-MM-DD date. */
export function dayBefore(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - 86400000)
    .toISOString()
    .slice(0, 10);
}

/** Thirty days before a YYYY-MM-DD date. */
const monthBefore = (date: string): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) - 30 * 86400000)
    .toISOString()
    .slice(0, 10);

/**
 * What the note could cover: every story the layout prints, in print order,
 * with what the reader's training, reads and the cluster say about it.
 * Stories whose address the previous issue's note already covered are left
 * out (`covered`).
 */
export async function briefingCandidates(
  repo: Repository,
  readerId: number,
  layout: Layout,
  byId: ReadonlyMap<number, Article>,
  date: string,
  covered: ReadonlySet<string> = new Set(),
): Promise<Candidate[]> {
  const entries = layout.groups.flatMap((g) =>
    g.desks.flatMap((d) =>
      d.stories.flatMap((s) => {
        const article = byId.get(s.id);
        return article
          ? [
              {
                article,
                also: s.also,
                coverage:
                  1 + new Set((s.siblings ?? []).map((x) => x.source)).size,
              },
            ]
          : [];
      }),
    ),
  );
  return toCandidates(repo, readerId, entries, monthBefore(date), covered);
}

/** The addresses of the stories a stored note covered. */
async function briefedUrls(
  repo: Repository,
  stored: string | null | undefined,
): Promise<Set<string>> {
  const ids = parseBriefedStories(stored ?? null).map((s) => s.id);
  if (!ids.length) return new Set();
  return new Set((await repo.articlesByIds(ids)).map((a) => a.url));
}

/**
 * The note for a layout: the stories it covers and the text, or nothing
 * when the reader turned the note off or too few stories qualify.
 */
export async function briefingFor(
  repo: Repository,
  env: CloudflareEnv,
  readerId: number,
  layout: Layout,
  date: string,
  prefs: Preferences,
  previous?: string | null,
): Promise<{
  readonly briefing: string | null;
  readonly briefed: readonly BriefedStory[];
  readonly stories: number;
}> {
  const byId = await issueArticles(repo, layout);
  if (!prefs.briefing_enabled) {
    return { briefing: null, briefed: [], stories: byId.size };
  }
  const picks = selectStories(
    await briefingCandidates(
      repo,
      readerId,
      layout,
      byId,
      date,
      await briefedUrls(repo, previous),
    ),
    prefs,
  );
  const briefing = await writeBriefing(env, picks, prefs, date);
  return {
    briefing,
    briefed: briefing
      ? picks.map((p) => ({ id: p.candidate.article.id, category: p.category }))
      : [],
    stories: byId.size,
  };
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
  await scorePrompts(env, repo, userId, date);
  const layout = await composeLayout(repo, userId, date, userId);
  const { briefing, briefed, stories } = await briefingFor(
    repo,
    env,
    userId,
    layout,
    date,
    await repo.getPreferences(userId),
    (await repo.getIssue(userId, dayBefore(date)))?.briefing_stories,
  );
  await repo.saveIssue(
    userId,
    date,
    JSON.stringify(layout),
    briefing,
    briefed.length ? JSON.stringify(briefed) : null,
  );
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
  const { briefing, briefed, stories } = await briefingFor(
    repo,
    env,
    edition.user_id,
    layout,
    date,
    await repo.getPreferences(edition.user_id),
    (await repo.getEditionIssue(edition.id, dayBefore(date)))?.briefing_stories,
  );
  await repo.saveEditionIssue(
    edition.id,
    date,
    JSON.stringify(layout),
    briefing,
    briefed.length ? JSON.stringify(briefed) : null,
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
    ? {
        date,
        layout,
        briefing: row.briefing,
        briefing_stories: parseBriefedStories(row.briefing_stories),
        created_at: row.created_at,
      }
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
    ? {
        date,
        layout,
        briefing: row.briefing,
        briefing_stories: parseBriefedStories(row.briefing_stories),
        created_at: row.created_at,
      }
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
      briefing_stories: [],
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
      briefing_stories: [],
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
